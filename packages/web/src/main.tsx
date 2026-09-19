import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

function theme(): "light" | "dark" {
  const saved = localStorage.getItem("ai-memory-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(t: "light" | "dark") {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("ai-memory-theme", t);
}

apply(theme());

// Expose a tiny theme toggle for keyboard users: press "t" outside inputs.
document.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
  if (e.key === "t" && !e.metaKey && !e.ctrlKey) {
    apply(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  }
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!localStorage.getItem("ai-memory-theme")) apply(e.matches ? "dark" : "light");
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
