// AI agent: Gemini-powered backend logic
// Functionality: For each testId, keep an array of prompts. If testType is 'test', use the current prompt. Else, send a Gemini prompt for 150 medium/high MCQs with 4 options in the required JSON format.

// Store prompts per testId
const testPrompts = {};

const buildQuizPromptText = (pdfJson) => {
  return `
Using ONLY the text below, create 10 multiple-choice questions.

OUTPUT RULES:
- Output must be ONLY a valid JSON array.
- No markdown, no backticks, no explanation outside JSON.
- Do NOT add text before or after the JSON array.

QUESTION FORMAT (every item must follow this):
{
  "title": "one line question",
  "options": [
    { "label": "A", "text": "" },
    { "label": "B", "text": "" },
    { "label": "C", "text": "" },
    { "label": "D", "text": "" }
  ],
  "answer": "A",
  "explanation": "short explanation"
}

STRICT RULES:
- Generate exactly 10 questions.
- 4 options only (A,B,C,D).
- "answer" must match a label.
- No empty fields.
- No null values.

TEXT_START
${pdfJson.text}
TEXT_END
  `.trim();
};

const apiKey = "AIzaSyCKf6wGvdUxEYfPJL--Lcp8ybcdJe-Fvbg";
import { supabase } from "../supabase.js";
import { generateSimpleTestId } from "../utils/GenerateTestId.js";
import convertPdfToJson from "../utils/pdfToJson.js";

const GEMINI_MODEL_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const buildPromptText = (index, pdfJson) => {
  const prompt = `
Read the text and extract programming questions.

OUTPUT MUST BE ONLY A PURE JSON ARRAY.
NO markdown, NO backticks, NO extra text.

Each JSON object represents a question and MUST contain EXACTLY these fields:

{
  "title": "",
  "description": "",
  "functionName": "solve",
  "sampleTestCase": {
       "input": [],         // array of parameters in the correct order
       "expected": any
  },
  "hiddenTestCases": [
       { "input": [], "expected": any },
       ... exactly 10 total
  ],
  "examples": [
       { "input": [], "expected": any },
       ... exactly 2 total
  ],
  "category": "odd" or "even"
}

STRICT RULES:
- Every "input" must be an ARRAY of parameters in proper order.
  Example: solve(nums, target) → "input": [["2","7","11"], 9]
- NEVER return empty objects.
- NEVER return null values.
- ALWAYS generate realistic and valid testcases matching the question.
- Detect category:
    Questions under "ODD System No." → "category": "odd"
    Questions under "EVEN System No." → "category": "even"

INPUT_TEXT_START
${pdfJson.text}
INPUT_TEXT_END
`;

  return prompt.trim();
};

const callGemini = async (prompt, apiKey) => {
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not configured");
  }
  // console.log("prompt is ", prompt);

  const response = await fetch(GEMINI_MODEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini API failed (${response.status}): ${errorText.slice(0, 200)}`
    );
  }

  const result = await response.json();

  // ---- Handle the correct Gemini structure ----
  // primary
  let text =
    result?.candidates?.[0]?.content?.parts?.[0]?.text ??
    result?.candidates?.[0]?.output_text ??
    result?.text ??
    result?.response?.text ??
    null;

  // Remove ```json and ``` wrappers
  text = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    const parsed = JSON.parse(text);
    return parsed; // Could be object or array
  } catch (err) {
    console.log("error is ", err);
  }
  const fixed = "[" + text.replace(/\}\s*\{/g, "},{") + "]";
  // Gemini usually returns a JSON string → parse it
  try {
    return JSON.parse(fixed);
  } catch (err) {
    console.log("error is ", err);
    return text;
  }
};

// POST /api/test
export const createTest = async (req, res) => {
  try {
    const { teacherId, testType = "test" } = req.body;

    if (!teacherId) {
      return res.status(400).json({ error: "Missing teacherId or password" });
    }

    // 1️⃣ Validate teacher from teacherusers table
    const { data: teacher, error } = await supabase
      .from("teacherusers") // table name must be lowercase
      .select("*")
      .eq("userId", teacherId)
      .maybeSingle();

    if (error) {
      console.log("Teacher lookup error:", error);
    }

    if (!teacher) {
      return res.status(403).json({ error: "Invalid teacher credentials" });
    }

    // 2️⃣ Generate unique testId
    const testId = "test_" + generateSimpleTestId();

    // 3️⃣ Store in tests table
    const { error: insertError } = await supabase
      .from("tests")
      .insert([{ testId: testId, teacherId: teacherId, testType: testType }]);

    if (insertError) {
      console.log("Insert tests error:", insertError);
      return res.status(500).json({ error: "Failed to create test" });
    }

    return res.json({ testId, teacherId });
  } catch (err) {
    console.log("CREATE TEST ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

/**
 * POST /api/uploadQuestions
 * form-data: { testId, pdf (file) }
 */
export const uploadQuestions = async (req, res) => {
  try {
    const { testId } = req.body;
    const pdf = req.file;
    const promptIndex = Math.max(0, Number(req.body.promptIndex ?? 0));

    if (!testId || !pdf) {
      return res.status(400).json({ error: "Missing testId or pdf" });
    }

    // 1️⃣ Check test exists
    const { data: testRow, error: testError } = await supabase
      .from("tests")
      .select("*")
      .eq("testId", testId)
      .maybeSingle();

    if (testError) {
      console.log("Test lookup error:", testError);
    }

    if (!testRow) {
      return res.status(404).json({ error: "Test not found" });
    }

    // 2️⃣ Upload PDF to Supabase Storage bucket "tests"
    const fileName = `${testId}.pdf`;

    const { error: storageError } = await supabase.storage
      .from("Tests")
      .upload(fileName, pdf.buffer, {
        contentType: "application/pdf",
        upsert: true, // overwrite if exists
      });

    if (storageError) {
      console.log("Storage upload error:", storageError);
      return res.status(500).json({ error: "Failed to upload PDF" });
    }

    // 3️⃣ Convert PDF → JSON
    const jsonData = await convertPdfToJson(pdf.buffer);

    // Store prompt for this testId
    if (!testPrompts[testId]) testPrompts[testId] = [];

    let promptText, transformedJson;

    const testType = (testRow.testType || "test").toLowerCase();

    if (testType === "quiz") {
      promptText = buildQuizPromptText(jsonData);
    } else {
      promptText = buildPromptText(promptIndex, jsonData);
    }
    testPrompts[testId].push(promptText);
    transformedJson = await callGemini(promptText, apiKey);
    // 4️⃣ Store Gemini-transformed JSON in tests_json table
    const { error: jsonError } = await supabase
      .from("tests_json")
      .insert([
        { testId: testId, jsondata: transformedJson, testType: testType },
      ]);

    if (jsonError) {
      console.log("Insert tests_json error:", jsonError);
      return res.status(500).json({ error: "Failed to save questions JSON" });
    }

    return res.json({
      msg: "Questions uploaded and processed",
      testId,
      testType,
    });
  } catch (err) {
    console.log("UPLOAD QUESTIONS ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

/**
 * GET /api/test/:testId
 * Returns the JSON questions for that test
 */
export const getTestQuestions = async (req, res) => {
  try {
    const { testId } = req.params;

    // Get questions JSON
    const { data: jsonRow, error: jsonError } = await supabase
      .from("tests_json")
      .select("jsondata")
      .eq("testId", testId)
      .maybeSingle();

    if (jsonError) {
      console.log("Fetch tests_json error:", jsonError);
    }

    if (!jsonRow) {
      return res.status(404).json({ error: "Test questions not found" });
    }

    // Get testType from tests table
    const { data: testRow, error: testError } = await supabase
      .from("tests")
      .select("testType")
      .eq("testId", testId)
      .maybeSingle();

    if (testError) {
      console.log("Fetch testType error:", testError);
    }

    return res.json({
      questions: jsonRow.jsondata,
      testType: testRow?.testType || null,
    });
  } catch (err) {
    console.log("GET TEST QUESTIONS ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
// GET /api/test/:testId

export const serverRunning = (req, res) => {
  return res.json({ msg: "working" });
};
export const checkUser = async (req, res) => {
  try {
    const { userId, password } = req.query;

    if (!userId || !password) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const { data: teacher } = await supabase
      .from("teacherusers")
      .select("*")
      .eq("userId", userId)
      .eq("password", password)
      .single();

    if (teacher) {
      return res.json({ role: "teacher" });
    } else {
      return res.json({ role: "student" });
    }
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Server error" });
  }
};

/**
 * POST /api/submit
 * body: { userId, testId, testType, passed, totalQuestions }
 * Checks for submit_<testId> table, creates if missing, inserts submission
 */
export const submitResult = async (req, res) => {
  try {
    const { userId, testId, testType, passed, totalQuestions } = req.body;

    if (
      !userId ||
      !testId ||
      !testType ||
      passed == null ||
      totalQuestions == null
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // Insert into single submissions table
    const { error: insertError } = await supabase
      .from("submissions")
      .insert([{ userId, testId, testType, passed, totalQuestions }]);
    if (insertError) {
      return res.status(500).json({
        error: "Failed to submit result",
        details: insertError.message,
      });
    }
    return res.json({
      msg: "Submission recorded",
      userId,
      testId,
      testType,
      passed,
      totalQuestions,
    });
  } catch (err) {
    console.log("SUBMIT RESULT ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

/**
 * GET /api/teacher/:teacherId/tests
 * Returns all tests created by a specific teacher
 */
export const getTeacherTests = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!teacherId) {
      return res.status(400).json({ error: "Missing teacherId" });
    }

    const { data, error } = await supabase
      .from("tests")
      .select("*")
      .eq("teacherId", teacherId)
      .order("created_at", { ascending: false });

    if (error) {
      console.log("Fetch teacher tests error:", error);
      return res.status(500).json({ error: "Failed to fetch tests" });
    }

    return res.json({ tests: data || [], count: data?.length || 0 });
  } catch (err) {
    console.log("GET TEACHER TESTS ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
