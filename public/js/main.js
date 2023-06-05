document.getElementById("submitBtn").addEventListener("click", async () => {
  const questionInput = document.getElementById("questionInput");
  const question = questionInput.value;

  if (question.trim() === "") return;

  const responseContainer = document.getElementById("responseContainer");
  const submitBtn = document.getElementById("submitBtn");
  const spinner = document.getElementById("spinner");

  // Desactiva el input y el botón, muestra el spinner
  questionInput.disabled = true;
  submitBtn.disabled = true;
  spinner.style.display = "block";

  try {
    const response = await axios.post("/question", { question });

    if (response.data && response.data.answer) {
      const answer = document.createElement("p");
      answer.textContent = response.data.answer;
      addCopyButton(answer);
      responseContainer.appendChild(answer);
    }

    questionInput.value = "";
  } catch (error) {
    console.error(error);
  } finally {
    // Activa el input y el botón, oculta el spinner
    questionInput.disabled = false;
    submitBtn.disabled = false;
    spinner.style.display = "none";
  }
});

const charCount = document.getElementById("charCount");

document.getElementById("questionInput").addEventListener("input", () => {
  charCount.textContent = `${
    document.getElementById("questionInput").value.length
  } / 32000 caracteres`;
});

function addCopyButton(answer) {
  const copyButton = document.createElement("button");
  copyButton.textContent = "Copiar";
  copyButton.addEventListener("click", () => {
    navigator.clipboard
      .writeText(answer.textContent)
      .then(() => {
        console.log("Texto copiado al portapapeles");
      })
      .catch((err) => {
        console.log("Error al copiar texto: ", err);
      });
  });
  answer.appendChild(copyButton);
}
