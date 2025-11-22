export function generateSimpleTestId() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  const hour = now.getHours(); // 0–23
  console.log("Generated testId:", `${day}-${month}-${year}-${hour}`);
  return `${day}-${month}-${year}-${hour}`;
}
