const API = "http://localhost:8000";
const WORKSPACE = "http://localhost:5173/";
let pageData = null;
const titleNode = document.getElementById("page-title");
const urlNode = document.getElementById("page-url");
const statusNode = document.getElementById("status");
const answerNode = document.getElementById("answer");
const tableNode = document.getElementById("table-results");

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    throw new Error("Open a normal HTTP or HTTPS webpage to use the companion.");
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      title: document.title,
      url: location.href,
      text: (window.getSelection()?.toString() || document.body?.innerText || "").slice(0, 30000),
      tables: Array.from(document.querySelectorAll("table")).slice(0, 8).map(table =>
        Array.from(table.querySelectorAll("tr")).slice(0, 30).map(row =>
          Array.from(row.querySelectorAll("th,td")).map(cell => (cell.innerText || "").trim().slice(0, 300))
        )
      ),
    }),
  });
  pageData = result.result;
  titleNode.textContent = pageData.title || "Untitled page";
  urlNode.textContent = pageData.url;
  urlNode.href = pageData.url;
}

document.getElementById("analyze").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  statusNode.textContent = "Analyzing extracted page text…";
  try {
    if (!pageData) await readPage();
    const response = await fetch(`${API}/api/browser/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: pageData.title,
        url: pageData.url,
        text: pageData.text,
        question: document.getElementById("question").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Page analysis failed");
    answerNode.textContent = `${data.answer}\n\n${data.notice}`;
    answerNode.hidden = false;
    statusNode.textContent = "Extractive mode — no AI key required.";
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : "Page analysis failed.";
  } finally {
    button.disabled = false;
  }
});

document.getElementById("tables").addEventListener("click", async () => {
  try {
    if (!pageData) await readPage();
    tableNode.textContent = pageData.tables.length
      ? JSON.stringify(pageData.tables, null, 2)
      : "No tables were found on this page.";
    tableNode.hidden = false;
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : "Could not extract tables.";
  }
});

document.getElementById("send").addEventListener("click", async () => {
  try {
    if (!pageData) await readPage();
    const workspace = new URL(WORKSPACE);
    workspace.searchParams.set("browser_title", pageData.title || "Webpage");
    workspace.searchParams.set("browser_url", pageData.url);
    workspace.searchParams.set("browser_content", pageData.text.slice(0, 2500));
    await chrome.tabs.create({ url: workspace.toString() });
    statusNode.textContent = "Page excerpt opened in a new WebPilot workspace tab.";
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : "Could not open the workspace.";
  }
});

readPage().catch(error => {
  titleNode.textContent = "Page unavailable";
  statusNode.textContent = error instanceof Error ? error.message : "Could not read the active page.";
});
