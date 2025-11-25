import express from "express";
import cors from "cors";
import helmet from "helmet";
import taskRoute from "./routes/task.route.js";

const app = express();

app.use(cors()); // Enable CORS

app.use(express.json());
console.log("started");
app.use("/api", taskRoute);
app.use(helmet()); // Security headers
const PORT = process.env.PORT || 8082;

app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
