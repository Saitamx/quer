// Captura los elementos del DOM
const responseContainer = document.querySelector("#responseContainer");
const submitBtn = document.querySelector("#submitBtn");
const questionInput = document.querySelector("#questionInput");
const recordBtn = document.querySelector("#recordBtn");
const readButton = document.querySelector("#read-button");
const charCount = document.querySelector("#charCount");
const spinner = document.querySelector("#spinner");

// Crea una nueva instancia de axios
const api = axios.create({
  baseURL: "http://localhost:3000",
});

// Actualiza el contador de caracteres
function updateCharCount() {
  charCount.textContent = `${questionInput.value.length} / 32000 caracteres`;
}

// Captura el evento del botón
submitBtn.addEventListener("click", function () {
  spinner.style.display = "block";
  // Realiza una solicitud
  api
    .post("/question", { question: questionInput.value.trim() })
    .then((response) => {
      spinner.style.display = "none";
      if (response.data) {
        const answerContainer = document.createElement("div");
        answerContainer.textContent = response.data.answer;
        responseContainer.appendChild(answerContainer);
      }
    })
    .catch((error) => {
      spinner.style.display = "none";
      console.error(error);
    });
});

// Añade un event listener al botón "Leer respuesta"
readButton.addEventListener("click", function () {
  let speech = new SpeechSynthesisUtterance();
  speech.text = responseContainer.textContent; // Lee el texto del contenedor de respuesta
  window.speechSynthesis.speak(speech);
});

// Crear nueva instancia de reconocimiento de voz
var recognition = new (window.SpeechRecognition ||
  window.webkitSpeechRecognition ||
  window.mozSpeechRecognition ||
  window.msSpeechRecognition)();

recognition.lang = "es-ES"; // Establecer el idioma a español
recognition.interimResults = false; // Queremos obtener resultados finales, no intermedios
recognition.maxAlternatives = 1; // Y queremos una sola alternativa de transcripción

// Cuando el reconocimiento de voz tenga resultados, tomar la transcripción y usarla
recognition.onresult = function (event) {
  questionInput.value = event.results[0][0].transcript;
  updateCharCount();
};

// Al hacer click en el botón de grabar voz, iniciar el reconocimiento
recordBtn.addEventListener("click", function (e) {
  recognition.start();
});
