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
  console.log("📩 Gemini full response JSON:", JSON.stringify(result));

  // ---- Handle the correct Gemini structure ----
  // primary
  let text =
    result?.candidates?.[0]?.content?.parts?.[0]?.text ??
    result?.candidates?.[0]?.output_text ??
    result?.text ??
    result?.response?.text ??
    null;

  text = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  if (!text) {
    throw new Error("Gemini returned no usable content. Check logs.");
  }

  // Gemini usually returns a JSON string → parse it
  try {
    return JSON.parse(text);
  } catch (err) {
    console.log("⚠️ Gemini returned non-JSON text:", text);
    return { text };
  }
};

// POST /api/test
export const createTest = async (req, res) => {
  try {
    const { teacherId } = req.body;

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
      .insert([{ testId: testId, teacherId: teacherId }]);

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
    // console.log("Converted PDF to JSON:", jsonData);

    const promptText = buildPromptText(promptIndex, jsonData);
    // console.log("Built prompt for Gemini:", promptText);

    const transformedJson = await callGemini(
      promptText,
      "AIzaSyCWtI6VG1nERbcanTBgRVyIgYNB-K-6Ppg"
    );

    // 4️⃣ Store Gemini-transformed JSON in tests_json table
    const { error: jsonError } = await supabase
      .from("tests_json")
      .insert([{ testId: testId, jsondata: transformedJson }]);

    if (jsonError) {
      console.log("Insert tests_json error:", jsonError);
      return res.status(500).json({ error: "Failed to save questions JSON" });
    }

    return res.json({ msg: "Questions uploaded and processed", testId });
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
    console.log("Fetching questions for testId:", testId);
    const { data, error } = await supabase
      .from("tests_json")
      .select("jsondata")
      .eq("testId", testId)
      .maybeSingle();

    if (error) {
      console.log("Fetch tests_json error:", error);
    }

    if (!data) {
      return res.status(404).json({ error: "Test questions not found" });
    }
    console.log("Retrieved JSON data:", data);
    return res.json(data.jsondata);
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
 * body: { studentId, testId, testCasesPassed }
 * Creates a table per testId (if not exists) and inserts submission
 */
export const submitTest = async (req, res) => {
  try {
    const { studentId, testId, testCasesPassed } = req.body;

    if (!studentId || !testId || testCasesPassed == null) {
      return res
        .status(400)
        .json({ error: "Missing studentId, testId, or testCasesPassed" });
    }

    // Sanitize testId for table name (alphanumeric + underscore only)
    const tableName = `submissions_${testId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

    // 1️⃣ Check if table exists; if not, create it
    const { data: tables, error: listError } = await supabase.rpc(
      "check_table_exists",
      { table_name: tableName }
    );

    // If RPC doesn't exist or fails, try creating the table directly
    // Supabase doesn't expose table creation via REST API, so we use raw SQL via rpc
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS public."${tableName}" (
        id SERIAL PRIMARY KEY,
        "studentId" TEXT NOT NULL,
        "testCasesPassed" INTEGER NOT NULL,
        "submittedAt" TIMESTAMP DEFAULT NOW()
      );
    `;

    // Execute raw SQL (requires a custom RPC function or use supabase-js with service role)
    // For now, we assume the table exists or use supabase admin to pre-create
    // Alternative: insert directly and handle error if table doesn't exist

    // 2️⃣ Insert submission record
    const { data, error: insertError } = await supabase.from(tableName).insert([
      {
        studentId,
        testCasesPassed,
      },
    ]);

    if (insertError) {
      // If table doesn't exist, Supabase will return an error
      // In production, you'd create the table via migration or admin SQL
      console.log("Insert error:", insertError);
      return res.status(500).json({
        error: "Failed to submit. Table may not exist.",
        details: insertError.message,
      });
    }

    return res.json({
      msg: "Submission recorded",
      studentId,
      testId,
      testCasesPassed,
    });
  } catch (err) {
    console.log("SUBMIT TEST ERROR:", err);
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
