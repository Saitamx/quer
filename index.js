// Importación de módulos necesarios
const similarity = require("compute-cosine-similarity");
const express = require("express");
const natural = require("natural");
const sw = require("stopword");
const axios = require("axios");
const rateLimit = require("axios-rate-limit");
require("dotenv").config();

// Limita a 60 solicitudes por minuto
const http = rateLimit(axios.create(), {
  maxRequests: 60,
  perMilliseconds: 60000,
});

// Creación de la aplicación Express
const app = express();

// Configuración de middleware para servir archivos estáticos y parsear JSON
app.use(express.static("public"));
app.use(express.json());

// Configuración de variables de entorno
const {
  OPENAI_API_KEY,
  CHAT_SERVICE,
  EMBEDDINGS_SERVICE,
  PARKS_SERVICE,
  EMBEDDING_MODEL,
  CHAT_MODEL,
  NUM_SIMILAR_PARKS,
  MAX_TOKENS,
} = process.env;

// Contexto general para la conversación
const generalContext = `
Soy QUER, una inteligencia artificial de EcoquerAI. Nuestro objetivo es combatir la inactividad física que afecta a una gran parte de la población mundial. Para lograr esto, proporcionamos una plataforma digital que facilita el descubrimiento de instalaciones deportivas, proporciona entrenamientos personalizados y fomenta la interacción comunitaria a través de eventos y desafíos. 
Además, EcoquerAI incluye una tienda en línea para accesorios, ropa y suplementos deportivos. Aspiramos a convertirnos en la red social líder para deportistas y entusiastas del fitness, expandiendo nuestras funcionalidades a otros espacios deportivos.
La innovación de EcoquerAI radica en la integración de la inteligencia artificial para personalizar las rutinas de entrenamiento según las metas y las instalaciones disponibles, algo que otras plataformas no ofrecen. También proporcionamos una base de datos de parques de calistenia y otros espacios deportivos, permitiendo a los usuarios descubrir nuevos lugares para entrenar.
Estoy aquí para ayudar a los usuarios de EcoquerAI y contribuir a su experiencia enriquecedora mientras protejo la información sensible. Actualmente, estoy programado para proporcionar información específica sobre parques de calistenia, nutrición, longevidad y buenos hábitos. Puedo ayudarte a encontrar parques de calistenia en tu área, darte consejos sobre nutrición y hábitos saludables, y proporcionarte información sobre cómo mejorar tu longevidad a través del ejercicio y una dieta saludable.`;

// Inicialización de la conversación
let conversation = [];

// Configuración de herramientas de procesamiento de texto
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmerEs;

// Función para contar los tokens en un mensaje
const countTokens = (message) => {
  return Math.ceil(message.length / 4.5);
};

// Función para obtener la incrustación de un texto
const handleEmbeddingResponse = async (input) => {
  const embeddingResponse = await http.post(
    EMBEDDINGS_SERVICE,
    {
      input,
      model: EMBEDDING_MODEL,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  return embeddingResponse.data.data[0].embedding;
};

// Función para obtener los datos de los parques y sus incrustaciones
const getParksData = async () => {
  const response = await http.get(PARKS_SERVICE);
  const promises = response.data.map(async (park) => {
    try {
      const parkContext = park.name + " " + park.id;
      const parkEmbedding = await handleEmbeddingResponse(parkContext);
      return {
        park,
        embedding: parkEmbedding,
      };
    } catch (error) {
      // Manejo de errores en caso de que la incrustación falle
      console.error(`Failed to get embedding for park ${park.id}: ${error}`);
      return null;
    }
  });

  // Espera a que todas las incrustaciones estén listas y filtra los resultados nulos
  const results = await Promise.all(promises);
  const parkEmbeddings = results.filter((result) => result !== null);
  return parkEmbeddings;
};

// Función para calcular la similitud entre la pregunta del usuario y los parques
const handleVectorial = (questionContextEmbedding, parksDataEmbeddings) => {
  const parksSimilarityScores = parksDataEmbeddings.map((parkEmbedding) => {
    return {
      park: parkEmbedding.park,
      similarity: similarity(questionContextEmbedding, parkEmbedding.embedding),
    };
  });

  // Ordena los parques por similitud
  parksSimilarityScores.sort((a, b) => b.similarity - a.similarity);

  // Si no se encuentra ningún parque coincidente, lanza un error
  if (parksSimilarityScores[0].similarity === -1) {
    throw new Error("No matching park found");
  }

  // Retorna los primeros N parques más similares
  const numSimilarParks = parseInt(NUM_SIMILAR_PARKS);
  const topSimilarParks = parksSimilarityScores.slice(0, numSimilarParks);

  // Prepara los datos finales para la conversación
  const finalParksData = topSimilarParks.map((similarPark) =>
    JSON.stringify(similarPark.park)
  );
  let finalGeneralContext = generalContext + "\n" + finalParksData.join("\n");

  return { finalGeneralContext, questionContextEmbedding, finalParksData };
};

// Función para preprocesar el texto
const preprocessText = (text) => {
  // Convertir a minúsculas
  text = text.toLowerCase();

  // Tokenizar el texto (dividirlo en palabras)
  let tokens = tokenizer.tokenize(text);

  // Eliminar palabras vacías
  tokens = sw.removeStopwords(tokens);

  // Lematizar los tokens
  tokens = tokens.map((token) => stemmer.stem(token));

  // Unir los tokens de nuevo en una cadena
  text = tokens.join(" ");

  return text;
};

// Endpoint para manejar las preguntas del usuario
app.post("/question", async (req, res) => {
  let { question, audio } = req.body;

  if (audio) {
    const audioBuffer = Buffer.from(audio, "base64");
    const [response] = await client.recognize({
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        languageCode: "es-ES",
      },
      audio: {
        content: audioBuffer.toString("base64"),
      },
    });
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join("\n");
    question = transcription;
  }

  question = preprocessText(question);

  try {
    // Obtiene los datos de los parques y la incrustación de la pregunta
    const parksDataEmbeddings = await getParksData();
    const questionContextEmbedding = await handleEmbeddingResponse(question);

    // Calcula la similitud entre la pregunta y los parques
    const { finalGeneralContext, finalParksData } = handleVectorial(
      questionContextEmbedding,
      parksDataEmbeddings
    );

    // Asegúrate de que el mensaje no exceda el límite de tokens
    if (countTokens(finalGeneralContext) > MAX_TOKENS) {
      return res.status(400).json({ error: "Message is too long" });
    }

    // Añade la pregunta y el contexto a la conversación
    conversation.push(
      { role: "system", content: finalGeneralContext },
      { role: "user", content: question }
    );

    // Calcula el número total de tokens en la conversación
    let totalTokens = conversation.reduce(
      (total, message) => total + countTokens(message.content),
      0
    );

    // Si la conversación tiene demasiados tokens, elimina los mensajes más antiguos hasta que esté por debajo del límite
    while (totalTokens > MAX_TOKENS) {
      const removedMessage = conversation.shift();
      totalTokens -= countTokens(removedMessage.content);
    }

    console.log("conversation:", new Date(), conversation);

    // Realiza la solicitud a la API de OpenAI
    const response = await http.post(
      CHAT_SERVICE,
      {
        model: CHAT_MODEL,
        messages: conversation,
        temperature: 0.7, // experimentar con diferentes valores aquí, como 0.2, 0.5, 1, etc
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Envía la respuesta de la API al cliente
    res.json({
      answer: `QUER AI: ${response.data.choices[0].message["content"]}`,
      parks: finalParksData,
    });
  } catch (error) {
    // Manejo de errores
    console.log(error.response);
    res.status(500).json({ error: "An error occurred" });
  }
});

// Inicia el servidor
app.listen(3000, () => console.log("Server started on port 3000"));
