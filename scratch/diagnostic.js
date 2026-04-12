const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config({ path: '.env.local' });

async function test() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.error("No API key found in .env.local");
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    const result = await model.generateContent("Hello!");
    const response = await result.response;
    const text = response.text();
    console.log("SUCCESS:", text);
  } catch (err) {
    console.error("DIAGNOSTIC_FAILURE:", err.message);
    if (err.message.includes("not found")) {
      console.log("SUGGESTION: Try 'gemini-pro' or 'gemini-1.5-pro'");
    }
  }
}

test();
