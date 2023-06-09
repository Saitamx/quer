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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHAT_SERVICE = process.env.CHAT_SERVICE;
const EMBEDDINGS_SERVICE = process.env.EMBEDDINGS_SERVICE;
const PARKS_SERVICE = process.env.PARKS_SERVICE;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
const CHAT_MODEL = process.env.CHAT_MODEL;
const NUM_SIMILAR_PARKS = process.env.NUM_SIMILAR_PARKS;
const MAX_TOKENS = 2048;

// Configuración de contexto y usuario
const ecoqueraiContext = [
  process.env.ECOQUERAI_CONTEXT_1,
  process.env.ECOQUERAI_CONTEXT_2,
];
const userInfo = { name: "Matías" };

// Contexto general para la conversación
const generalContext = `
Soy QUER, una inteligencia artificial de EcoquerAI, una plataforma innovadora diseñada para conectar a deportistas y facilitar el acceso a espacios de entrenamiento, enfocándose en la calistenia. 
Mi función principal es "Entrena como QuerAI", donde recomiendo ejercicios y rutinas personalizadas basadas en las instalaciones disponibles y las necesidades individuales de los usuarios. 
Además, EcoquerAI incluye "La Ruta Calisténica", que anima a los usuarios a explorar parques y coleccionar códigos QR como parte de su experiencia de entrenamiento.
La plataforma está comprometida con la inclusión y el compromiso comunitario. En el futuro, EcoquerAI planea expandirse para incluir más deportes y características, como perfiles de deportistas con listas de reproducción, nutrición, 
y recomendaciones de especialistas en salud. También estamos trabajando en integraciones con dispositivos inteligentes para monitorear el sueño, el ritmo cardíaco y otros factores que afectan el rendimiento deportivo.
Como IA, estoy en constante evolución y se espera que mis recomendaciones se basen cada vez más en el aprendizaje automático. También, ayudaré a los usuarios a mantenerse al tanto de los torneos, obtener información sobre nutrición, 
técnicas de respiración, y más.
Estoy aquí para ayudar a los usuarios de EcoquerAI, incluido ${
  userInfo.name
}, y contribuir a su experiencia enriquecedora mientras protejo la información sensible. Actualmente, estoy utilizando el siguiente contexto específico sobre EcoquerAI: ${ecoqueraiContext.join(
  ", "
)}.`;

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
  let question = req.body.question;
  question = preprocessText(question);

  console.log("question:", question);

  try {
    // Obtiene los datos de los parques y la incrustación de la pregunta
    const parksDataEmbeddings = await getParksData();
    const questionContextEmbedding = await handleEmbeddingResponse(question);

    // Calcula la similitud entre la pregunta y los parques
    const { finalGeneralContext } = handleVectorial(
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
    ); // Calcula el número total de tokens en la conversación
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
    });
  } catch (error) {
    // Manejo de errores
    console.log(error.response);
    res.status(500).json({ error: "An error occurred" });
  }
});

// Inicia el servidor
app.listen(3000, () => console.log("Server started on port 3000"));
