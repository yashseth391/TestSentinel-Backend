import express from "express";
import multer from "multer";
import {
  checkUser,
  createTest,
  getTest,
  serverRunning,
} from "../controllers/task.controller.js";
console.log("In task route");
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST: upload pdf + save json
router.post("/test", upload.single("pdf"), createTest);

// GET: fetch json
router.get("/test/:testId", getTest);
router.get("/", serverRunning);
router.get("/userType", checkUser);
export default router;
