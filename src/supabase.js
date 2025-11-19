import { createClient } from "@supabase/supabase-js";
// import dotenv from "dotenv";
// dotenv.config();

// const supabaseUrl = process.env.SUPABASE_URL || "";
// const supabaseKey = process.env.SUPABASE_KEY || "";
const supabaseUrl = "https://iggyzkolpagccknuwbhr.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnZ3l6a29scGFnY2NrbnV3YmhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNDQyNjYsImV4cCI6MjA3ODcyMDI2Nn0.3LNjwfqqom4QWQ_xHRQQ9mE1Bz4jnn8r_7iCAYH_zQk";

export const supabase = createClient(supabaseUrl, supabaseKey);
