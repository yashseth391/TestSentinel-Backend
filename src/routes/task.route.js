import express from "express";
import multer from "multer";

import {
  checkUser,
  createTest,
  uploadQuestions,
  getTestQuestions,
  serverRunning,
  submitTest,
  getTeacherTests,
} from "../controllers/task.controller.js";

console.log("In task route");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// 1️⃣ Create test (teacher)
router.post("/createTest", createTest);

// 2️⃣ Upload test questions (PDF)
router.post("/uploadQuestions", upload.single("pdf"), uploadQuestions);

// 3️⃣ Fetch JSON questions by testId
router.get("/test/:testId", getTestQuestions);

// 4️⃣ User type check (teacher/student)
router.get("/userType", checkUser);

// 5️⃣ Submit test results (student)
router.post("/submit", submitTest);

// 6️⃣ Get all tests for a teacher
router.get("/teacher/:teacherId/tests", getTeacherTests);

// 7️⃣ Server health check
router.get("/", serverRunning);

export default router;
