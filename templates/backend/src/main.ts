import express from "express";

const PORT = 5000;

const app = express();

app.get("/", (_req, res) => {
  res.json({
    success: true, data: "Hello, World!"
  });
});

app.listen(PORT, () => {
  console.log(`Running at http://localhost:${PORT}`);
});
