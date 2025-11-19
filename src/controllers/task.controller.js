import { supabase } from "../supabase.js";
import convertPdfToJson from "../utils/pdfToJson.js";

// POST /api/test
export const createTest = async (req, res) => {
  try {
    const { userId, password, testId } = req.body;
    const pdf = req.file;

    if (!userId || !password || !testId || !pdf)
      return res.status(400).json({ error: "Missing fields" });

    // 1️⃣ Check if user exists in TeacherUsers
    const { data: teacher, error: teacherError } = await supabase
      .from("TeacherUsers")
      .select("*")
      .eq("userId", userId)
      .eq("password", password)
      .single();

    let isTeacher = false;

    if (teacher && !teacherError) {
      isTeacher = true;
    }

    // 2️⃣ If not teacher → student
    if (!isTeacher) {
      return res.status(403).json({ error: "Students cannot upload tests" });
    }

    // 3️⃣ Upload PDF
    const fileName = `${testId}.pdf`;

    await supabase.storage
      .from("tests")
      .upload(fileName, pdf.buffer, { contentType: "application/pdf" });

    // 4️⃣ Convert PDF → JSON
    const jsonData = await convertPdfToJson(pdf.buffer);

    // 5️⃣ Save JSON to DB
    await supabase.from("tests_json").insert([
      {
        testId,
        jsonData,
      },
    ]);

    return res.json({ msg: "Test uploaded", testId, role: "teacher" });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Server error" });
  }
};

// GET /api/test/:testId
export const getTest = async (req, res) => {
  try {
    const { testId } = req.params;

    const { data, error } = await supabase
      .from("tests_json")
      .select("jsonData")
      .eq("testId", testId)
      .single();

    if (!data || error)
      return res.status(404).json({ error: "Test not found" });

    return res.json(data.jsonData);
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
};

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
  } catch {
    console.log(err);
    return res.status(500).json({ error: "Server error" });
  }
};
