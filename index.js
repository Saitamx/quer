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

const app = express();

app.use(express.static("public"));
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHAT_SERVICE = process.env.CHAT_SERVICE;
const EMBEDDINGS_SERVICE = process.env.EMBEDDINGS_SERVICE;

const PARKS_SERVICE = process.env.PARKS_SERVICE;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
const CHAT_MODEL = process.env.CHAT_MODEL;
const NUM_SIMILAR_PARKS = process.env.NUM_SIMILAR_PARKS;
const MAX_TOKENS = 2048;

const ecoqueraiContext = [
  process.env.ECOQUERAI_CONTEXT_1,
  process.env.ECOQUERAI_CONTEXT_2,
];

const userInfo = { name: "Matías" };

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

// Función para contar los tokens en un mensaje
const countTokens = (message) => {
  return Math.ceil(message.length / 4.5);
};

// servicios externos
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
  const numSimilarParks = parseInt(NUM_SIMILAR_PARKS);
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

    const questionContextEmbedding = await handleEmbeddingResponse(question);

    const { finalGeneralContext } = handleVectorial(
      questionContextEmbedding,
      parksDataEmbeddings
    );

    // Asegúrate de que el mensaje no exceda el límite de tokens
    if (countTokens(finalGeneralContext) > MAX_TOKENS) {
      return res.status(400).json({ error: "Message is too long" });
    }

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

    const response = await http.post(
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
