const similarity = require("compute-cosine-similarity");
const express = require("express");
const natural = require("natural");
const sw = require("stopword");
const axios = require("axios");
const app = express();
require("dotenv").config();

app.use(express.static("public"));
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHAT_SERVICE = process.env.CHAT_SERVICE;
const EMBEDDINGS_SERVICE = process.env.EMBEDDINGS_SERVICE;

const PARKS_SERVICE = process.env.PARKS_SERVICE;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
const CHAT_MODEL = process.env.CHAT_MODEL;

const userInfo = { name: "Matías" };

const ecoqueraiContext = [
  `description: en un mundo cada vez más sedentario, mantenerse activo y saludable es un desafío constante. El acceso a espacios deportivos
    y a entrenamientos adecuados puede ser complicado, especialmente en el caso de la calistenia, una disciplina que utiliza el peso corporal 
    y que puede practicarse en parques y espacios públicos. Ecoquerai nace para solucionar este problema, ofreciendo una plataforma digital que 
    reúne información sobre parques de calistenia en todo el mundo y potencia la experiencia de entrenamiento con inteligencia artificial. Los 
    usuarios pueden descubrir parques cercanos, obtener detalles sobre sus instalaciones y acceder a rutinas de entrenamiento personalizadas, 
    adaptadas a sus objetivos y al equipamiento disponible. Además, Ecoquerai promueve la inclusión y el compromiso comunitario a través de 
    eventos y una función de recolección de códigos QR. Finalmente, la plataforma incluye un ecommerce de accesorios, ropa y suplementos deportivos, 
    completando una propuesta integral para la comunidad deportiva.
    Objetivo General del Proyecto:
    Desarrollar y lanzar Ecoquerai, una plataforma digital innovadora que integre inteligencia artificial adaptativa y principios de economía circular 
    para optimizar la experiencia de entrenamiento en calistenia y deportes en general, facilitar el acceso a información sobre parques y espacios deportivos, 
    y fomentar la conexión social entre deportistas de todos los niveles y habilidades.
    `,
];

const generalContext = `
Soy QUER una amable y muy perpicaz inteligencia artificial que conoce la jerga chilena, experto en 
calistenia, longevidad, biohacking, desarrollo de software, especializado en entender a los usuarios 
de ecoquerai, con el fin de obtener retroalimentación de estos y brindarles una buena experiencia de usuario, 
siempre considero proteger y no revelar información sensible. 
Estoy trabajando con: ${userInfo.name}, este es el contexto de ecoquerai: 
${ecoqueraiContext.join(", ")}.`;

let conversation = [];

const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmerEs;

// servicios externos
const handleEmbeddingResponse = async (input) => {
  const embeddingResponse = await axios.post(
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

const getParksData = async () => {
  const response = await axios.get(PARKS_SERVICE);
  const promises = response.data.map(async (park) => {
    try {
      const parkContext = park.name + " " + park.id;
      const parkEmbedding = await handleEmbeddingResponse(parkContext);
      return {
        park,
        embedding: parkEmbedding,
      };
    } catch (error) {
      console.error(`Failed to get embedding for park ${park.id}: ${error}`);
      return null;
    }
  });

  const results = await Promise.all(promises);
  const parkEmbeddings = results.filter((result) => result !== null);
  return parkEmbeddings;
};

// funciones
const handleVectorial = (questionContextEmbedding, parksDataEmbeddings) => {
  const parksSimilarityScores = parksDataEmbeddings.map((parkEmbedding) => {
    return {
      park: parkEmbedding.park,
      similarity: similarity(questionContextEmbedding, parkEmbedding.embedding),
    };
  });

  parksSimilarityScores.sort((a, b) => b.similarity - a.similarity);

  if (parksSimilarityScores[0].similarity === -1) {
    throw new Error("No matching park found");
  }

  // retornar los primeros N parques más similares
  const numSimilarParks = 5;
  const topSimilarParks = parksSimilarityScores.slice(0, numSimilarParks);

  const finalParksData = topSimilarParks.map((similarPark) =>
    JSON.stringify(similarPark.park)
  );

  let finalGeneralContext = generalContext + "\n" + finalParksData.join("\n");

  return { finalGeneralContext, questionContextEmbedding, finalParksData };
};

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

// endpoints
app.post("/question", async (req, res) => {
  let question = req.body.question;
  question = preprocessText(question);

  console.log("question:", question);

  try {
    const parksDataEmbeddings = await getParksData();

    console.log("parksDataEmbeddings:", parksDataEmbeddings);

    const questionContextEmbedding = await handleEmbeddingResponse(question);
    console.log("questionContextEmbedding:", questionContextEmbedding);

    const { finalGeneralContext } = handleVectorial(
      questionContextEmbedding,
      parksDataEmbeddings
    );

    console.log("finalGeneralContext:", finalGeneralContext);

    conversation.push(
      { role: "system", content: finalGeneralContext },
      { role: "user", content: question }
    );

    console.log("conversation", conversation);

    const response = await axios.post(
      CHAT_SERVICE,
      {
        model: CHAT_MODEL,
        messages: conversation,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      answer: `QUER AI: ${response.data.choices[0].message["content"]}`,
    });
  } catch (error) {
    console.log(error.response);
    res.status(500).json({ error: "An error occurred" });
  }
});

app.listen(3000, () => console.log("Server started on port 3000"));
