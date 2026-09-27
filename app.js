// 所有账单都保存在当前浏览器，不会上传到服务器。
const STORAGE_KEY = "xiaozhangben.transactions.v1";
const CATEGORIES = {
  expense: ["餐饮", "交通", "购物", "工作", "居住", "娱乐", "其他"],
  income: ["工资", "奖金", "兼职", "理财", "其他"],
};
const CATEGORY_COLORS = ["#7c4dff", "#a56cf5", "#d05ee5", "#ec6ab1", "#ff8a80", "#f4b860", "#63a8ff"];

const form = document.querySelector("#transaction-form");
const amountInput = document.querySelector("#amount");
const amountError = document.querySelector("#amount-error");
const noteInput = document.querySelector("#note");
const categoryGrid = document.querySelector("#category-grid");
const list = document.querySelector("#transaction-list");
const emptyState = document.querySelector("#empty-state");
const importText = document.querySelector("#import-text");
const importButton = document.querySelector("#import-button");
const importStatus = document.querySelector("#import-status");
const monthCalendar = document.querySelector("#month-calendar");
const searchInput = document.querySelector("#transaction-search");
const clearDateFilter = document.querySelector("#clear-date-filter");
let transactions = loadTransactions();
const now = new Date();
let calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
let selectedDateKey = "";

// localStorage 可能被手动修改；读取时只接受结构正确的记录。
function loadTransactions() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((item) => item && typeof item.id === "string" && Number.isInteger(item.amountCents) && item.amountCents > 0)
      : [];
  } catch {
    return [];
  }
}

function saveTransactions() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    return true;
  } catch {
    alert("保存失败，请检查 Safari 是否还有可用存储空间。");
    return false;
  }
}

// 用整数“分”保存金额，避免 0.1 + 0.2 之类的浮点误差。
function parseAmount(value) {
  const match = value.trim().match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

function formatMoney(cents) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 解析从账单列表复制出的文字；不带年份的近期记录按当前年（跨年时按上一年）处理。
function parseImportedTransactions(text, now = new Date()) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line !== "×");
  const items = [];

  lines.forEach((line, index) => {
    const amountMatch = line.match(/^([+−-])\s*¥\s*([\d,]+(?:\.\d{1,2})?)$/);
    const dateMatch = lines[index - 1]?.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*·\s*(.*))?$/);
    if (!amountMatch || !dateMatch || index < 2) return;

    const type = amountMatch[1] === "+" ? "income" : "expense";
    const category = lines[index - 2];
    const amountCents = parseAmount(amountMatch[2].replaceAll(",", ""));
    const [, monthText, dayText, hourText, minuteText, note = ""] = dateMatch;
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!amountCents || !CATEGORIES[type].includes(category) || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return;

    const createdAt = new Date(now.getFullYear(), month - 1, day, hour, minute);
    if (createdAt.getMonth() !== month - 1 || createdAt.getDate() !== day) return;
    if (createdAt.getTime() > now.getTime() + 86400000) createdAt.setFullYear(createdAt.getFullYear() - 1);
    items.push({ id: crypto.randomUUID(), type, amountCents, category, note: note.trim().slice(0, 60), createdAt: createdAt.toISOString() });
  });

  return items;
}

function transactionMinuteKey(item) {
  const date = new Date(item.createdAt);
  return [item.type, item.amountCents, item.category, date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), item.note || ""].join("|");
}

function importTransactions(text) {
  const parsed = parseImportedTransactions(text);
  const keys = new Set(transactions.map(transactionMinuteKey));
  const fresh = parsed.filter((item) => {
    const key = transactionMinuteKey(item);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });

  if (!parsed.length) return { imported: 0, skipped: 0, error: "没有识别到可导入的账单，请确认粘贴了完整文字。" };
  if (!fresh.length) return { imported: 0, skipped: parsed.length, error: "这些账单已经存在，不需要重复导入。" };

  const previous = transactions;
  transactions = [...transactions, ...fresh];
  if (!saveTransactions()) {
    transactions = previous;
    return { imported: 0, skipped: 0, error: "导入失败，请检查 Safari 是否还有可用存储空间。" };
  }
  render();
  navigator.storage?.persist?.();
  return { imported: fresh.length, skipped: parsed.length - fresh.length, error: "" };
}

function monthTotals(items, now = new Date()) {
  return items.reduce(
    (totals, item) => {
      const date = new Date(item.createdAt);
      if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
        totals[item.type] += item.amountCents;
      }
      return totals;
    },
    { income: 0, expense: 0 },
  );
}

function isSameDay(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function todayExpense(items, now = new Date()) {
  return items.reduce((total, item) => item.type === "expense" && isSameDay(new Date(item.createdAt), now) ? total + item.amountCents : total, 0);
}

// 汇总最近七个自然日，条形图始终从六天前画到今天。
function dailyExpenses(items, now = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + index);
    const amountCents = items.reduce((total, item) => item.type === "expense" && isSameDay(new Date(item.createdAt), date) ? total + item.amountCents : total, 0);
    return { date, amountCents };
  });
}

function monthCategoryExpenses(items, now = new Date()) {
  const totals = {};
  items.forEach((item) => {
    const date = new Date(item.createdAt);
    if (item.type === "expense" && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
      totals[item.category] = (totals[item.category] || 0) + item.amountCents;
    }
  });
  return Object.entries(totals).sort((left, right) => right[1] - left[1]);
}

function compactMoney(cents) {
  const amount = cents / 100;
  if (amount >= 10000) return `¥${(amount / 10000).toFixed(1)}万`;
  return amount ? `¥${amount.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}` : "0";
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// 日历按本地日期累计支出，避免 UTC 日期偏移到前一天。
function dailyExpenseTotals(items, month) {
  const totals = new Map();
  items.forEach((item) => {
    const date = new Date(item.createdAt);
    if (item.type !== "expense" || date.getFullYear() !== month.getFullYear() || date.getMonth() !== month.getMonth()) return;
    totals.set(date.getDate(), (totals.get(date.getDate()) || 0) + item.amountCents);
  });
  return totals;
}

function filterTransactions(items, query, dateKey) {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  return items
    .filter((item) => {
      if (keyword) return `${item.note || ""} ${item.category || ""}`.toLocaleLowerCase("zh-CN").includes(keyword);
      return !dateKey || localDateKey(new Date(item.createdAt)) === dateKey;
    })
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function renderCalendar() {
  const label = document.querySelector("#calendar-month-label");
  const hint = document.querySelector("#calendar-hint");
  const totals = dailyExpenseTotals(transactions, calendarMonth);
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  label.textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(calendarMonth);
  monthCalendar.replaceChildren();

  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let index = 0; index < leadingDays; index += 1) {
    const spacer = document.createElement("span");
    spacer.className = "month-day-spacer";
    spacer.setAttribute("aria-hidden", "true");
    monthCalendar.append(spacer);
  }

  const dayCount = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  for (let day = 1; day <= dayCount; day += 1) {
    const date = new Date(year, month, day);
    const key = localDateKey(date);
    const amountCents = totals.get(day) || 0;
    const button = document.createElement("button");
    button.className = "month-day";
    button.type = "button";
    button.dataset.date = key;
    button.setAttribute("aria-label", `${month + 1}月${day}日支出${formatMoney(amountCents)}`);
    button.setAttribute("aria-pressed", String(selectedDateKey === key));
    if (isSameDay(date, today)) {
      button.classList.add("is-today");
      button.setAttribute("aria-current", "date");
    }
    if (selectedDateKey === key) button.classList.add("is-selected");

    const number = document.createElement("span");
    number.className = "month-day-number";
    number.textContent = String(day);
    const amount = document.createElement("span");
    amount.className = "month-day-expense";
    amount.textContent = amountCents ? compactMoney(amountCents) : "¥0";
    button.append(number, amount);
    monthCalendar.append(button);
  }

  if (selectedDateKey) {
    const [, selectedMonth, selectedDay] = selectedDateKey.split("-").map(Number);
    const amountCents = totals.get(selectedDay) || 0;
    hint.textContent = `${selectedMonth}月${selectedDay}日支出 ${formatMoney(amountCents)} · 已筛选当天账单`;
  } else {
    hint.textContent = "点日期查看当天账单；每天金额为支出。";
  }
  clearDateFilter.hidden = !selectedDateKey;
}

function changeCalendarMonth(offset) {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1);
  selectedDateKey = "";
  searchInput.value = "";
  renderCalendar();
  renderTransactions();
}

function selectedType() {
  return form.elements.type.value;
}

function renderCategories() {
  categoryGrid.replaceChildren();
  CATEGORIES[selectedType()].forEach((category, index) => {
    const label = document.createElement("label");
    label.className = "category-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "category";
    input.value = category;
    input.checked = index === 0;
    const text = document.createElement("span");
    text.textContent = category;
    label.append(input, text);
    categoryGrid.append(label);
  });
}

function renderSummary() {
  const totals = monthTotals(transactions);
  document.querySelector("#today-expense").textContent = formatMoney(todayExpense(transactions));
  document.querySelector("#month-income").textContent = formatMoney(totals.income);
  document.querySelector("#month-expense").textContent = formatMoney(totals.expense);
  document.querySelector("#month-balance").textContent = formatMoney(totals.income - totals.expense);
}

function renderDailyChart() {
  const container = document.querySelector("#daily-bars");
  const days = dailyExpenses(transactions);
  const maximum = Math.max(...days.map((day) => day.amountCents), 1);
  container.replaceChildren();

  days.forEach((day, index) => {
    const column = document.createElement("div");
    column.className = "bar-column";
    const amount = document.createElement("span");
    amount.className = "bar-amount";
    amount.textContent = compactMoney(day.amountCents);
    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("span");
    bar.className = `bar-fill${day.amountCents ? "" : " is-zero"}`;
    bar.style.height = `${Math.max((day.amountCents / maximum) * 100, 3)}%`;
    track.append(bar);
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = index === 6 ? "今天" : `${day.date.getMonth() + 1}/${day.date.getDate()}`;
    column.setAttribute("aria-label", `${label.textContent}支出${formatMoney(day.amountCents)}`);
    column.append(amount, track, label);
    container.append(column);
  });
}

function renderCategoryChart() {
  const pie = document.querySelector("#category-pie");
  const legend = document.querySelector("#category-legend");
  const empty = document.querySelector("#pie-empty");
  const categories = monthCategoryExpenses(transactions);
  const total = categories.reduce((sum, [, cents]) => sum + cents, 0);
  document.querySelector("#pie-total").textContent = formatMoney(total);
  legend.replaceChildren();

  if (!total) {
    pie.style.background = "#eee8f7";
    pie.setAttribute("aria-label", "本月暂无支出");
    empty.hidden = false;
    return;
  }

  let start = 0;
  const segments = categories.map(([category, cents], index) => {
    const end = start + (cents / total) * 100;
    const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
    const segment = `${color} ${start}% ${end}%`;
    start = end;

    const item = document.createElement("div");
    item.className = "legend-item";
    const label = document.createElement("span");
    const dot = document.createElement("i");
    dot.style.background = color;
    label.append(dot, document.createTextNode(category));
    const value = document.createElement("strong");
    value.className = "legend-value";
    value.textContent = `${formatMoney(cents)} · ${Math.round((cents / total) * 100)}%`;
    item.append(label, value);
    legend.append(item);
    return segment;
  });

  pie.style.background = `conic-gradient(${segments.join(", ")})`;
  pie.setAttribute("aria-label", `本月支出${formatMoney(total)}，${categories.map(([category, cents]) => `${category}${Math.round((cents / total) * 100)}%`).join("，")}`);
  empty.hidden = true;
}

function renderTransactions() {
  list.replaceChildren();
  const query = searchInput.value.trim();
  const sorted = filterTransactions(transactions, query, selectedDateKey);

  sorted.forEach((item) => {
    const row = document.createElement("article");
    row.className = "transaction-item";

    const mark = document.createElement("span");
    mark.className = "category-mark";
    mark.textContent = item.category.slice(0, 2);

    const copy = document.createElement("div");
    copy.className = "transaction-copy";
    const title = document.createElement("strong");
    title.textContent = item.category;
    const meta = document.createElement("span");
    const time = new Date(item.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    meta.textContent = item.note ? `${time} · ${item.note}` : time;
    copy.append(title, meta);

    const amount = document.createElement("strong");
    amount.className = `transaction-amount ${item.type}`;
    amount.textContent = `${item.type === "income" ? "+" : "−"}${formatMoney(item.amountCents)}`;

    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `删除${item.category}${formatMoney(item.amountCents)}`);
    remove.addEventListener("click", () => deleteTransaction(item.id));

    row.append(mark, copy, amount, remove);
    list.append(row);
  });

  document.querySelector("#record-count").textContent = `${sorted.length} 笔`;
  emptyState.hidden = sorted.length > 0;
  emptyState.textContent = transactions.length === 0
    ? "还没有账单，先记下第一笔吧。"
    : query
      ? "没有找到匹配的账单。"
      : selectedDateKey
        ? "这一天没有账单。"
        : "没有账单。";
  document.querySelector("#record-filter-hint").textContent = query
    ? `在全部账单中搜索“${query}”`
    : selectedDateKey
      ? "只显示所选日期的账单"
      : "";
  clearDateFilter.hidden = !selectedDateKey;
}

function render() {
  renderSummary();
  renderCalendar();
  renderDailyChart();
  renderCategoryChart();
  renderTransactions();
}

function addTransaction({ type, amountCents, category, note = "" }) {
  const item = {
    id: crypto.randomUUID(),
    type,
    amountCents,
    category,
    note: note.trim().slice(0, 60),
    createdAt: new Date().toISOString(),
  };
  transactions.push(item);
  if (!saveTransactions()) transactions.pop();
  else {
    selectedDateKey = "";
    searchInput.value = "";
  }
  render();
  return item;
}

function deleteTransaction(id) {
  const item = transactions.find((transaction) => transaction.id === id);
  if (!item || !confirm(`删除这笔${item.type === "income" ? "收入" : "支出"}吗？`)) return;
  const previous = transactions;
  transactions = transactions.filter((transaction) => transaction.id !== id);
  if (!saveTransactions()) transactions = previous;
  render();
}

form.addEventListener("change", (event) => {
  if (event.target.name === "type") renderCategories();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const amountCents = parseAmount(amountInput.value);
  if (!amountCents) {
    amountError.textContent = "请输入大于 0、最多两位小数的金额。";
    amountInput.focus();
    return;
  }

  amountError.textContent = "";
  addTransaction({
    type: selectedType(),
    amountCents,
    category: form.elements.category.value,
    note: noteInput.value,
  });
  amountInput.value = "";
  noteInput.value = "";
  amountInput.focus();
  navigator.storage?.persist?.();
});

importButton.addEventListener("click", () => {
  const result = importTransactions(importText.value);
  importStatus.textContent = result.error || `已导入 ${result.imported} 笔${result.skipped ? `，跳过 ${result.skipped} 笔重复账单` : ""}。`;
  if (!result.error) importText.value = "";
});

document.querySelector("#previous-month").addEventListener("click", () => changeCalendarMonth(-1));
document.querySelector("#next-month").addEventListener("click", () => changeCalendarMonth(1));
monthCalendar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (!button) return;
  selectedDateKey = selectedDateKey === button.dataset.date ? "" : button.dataset.date;
  searchInput.value = "";
  renderCalendar();
  renderTransactions();
});
searchInput.addEventListener("input", renderTransactions);
clearDateFilter.addEventListener("click", () => {
  selectedDateKey = "";
  renderCalendar();
  renderTransactions();
});

// 支持 WebMCP 的浏览器可以让 AI 调用同一套记账逻辑；普通浏览器会直接跳过。
function registerWebMCP() {
  if (!document.modelContext?.registerTool) return;
  document.modelContext.registerTool({
    name: "add_transaction",
    title: "记一笔",
    description: "在小账本中新增一笔收入或支出。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["income", "expense"] },
        amount: { type: "number", exclusiveMinimum: 0 },
        category: { type: "string" },
        note: { type: "string" },
      },
      required: ["type", "amount", "category"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const amountCents = parseAmount(String(input.amount));
      if (!amountCents || !CATEGORIES[input.type]?.includes(input.category)) throw new Error("账单内容不正确");
      const item = addTransaction({ ...input, amountCents });
      return { id: item.id, saved: true };
    },
  });
}

// 最小自检：金额换算和本月统计出错时会在控制台直接报错。
console.assert(parseAmount("12.34") === 1234 && parseAmount("0") === null, "金额换算自检失败");
const selfCheck = monthTotals([
  { type: "income", amountCents: 1000, createdAt: new Date(2026, 8, 1).toISOString() },
  { type: "expense", amountCents: 350, createdAt: new Date(2026, 8, 2).toISOString() },
], new Date(2026, 8, 14));
console.assert(selfCheck.income === 1000 && selfCheck.expense === 350, "月度统计自检失败");
const chartCheck = [
  { type: "expense", category: "餐饮", amountCents: 300, createdAt: new Date(2026, 8, 14, 8).toISOString() },
  { type: "expense", category: "工作", amountCents: 200, createdAt: new Date(2026, 8, 14, 9).toISOString() },
];
console.assert(todayExpense(chartCheck, new Date(2026, 8, 14, 12)) === 500, "今日统计自检失败");
console.assert(dailyExpenses(chartCheck, new Date(2026, 8, 14, 12)).at(-1).amountCents === 500, "每日统计自检失败");
console.assert(monthCategoryExpenses(chartCheck, new Date(2026, 8, 14, 12)).find(([category]) => category === "餐饮")[1] === 300, "分类统计自检失败");
console.assert(dailyExpenseTotals(chartCheck, new Date(2026, 8, 1)).get(14) === 500, "月历每日支出自检失败");
const filterCheck = [
  { type: "expense", amountCents: 300, category: "工作", note: "机油", createdAt: new Date(2026, 8, 12).toISOString() },
  { type: "expense", amountCents: 200, category: "餐饮", note: "午餐", createdAt: new Date(2026, 8, 14).toISOString() },
];
console.assert(filterTransactions(filterCheck, "机油", localDateKey(new Date(2026, 8, 14))).length === 1, "备注搜索应查找全部日期");
console.assert(filterTransactions(filterCheck, "", localDateKey(new Date(2026, 8, 14))).length === 1, "日期筛选自检失败");
const importCheck = parseImportedTransactions("餐饮\n餐饮\n9/20 17:59 · 晚餐\n−¥12.34\n×\n工资\n工资\n9/20 18:00\n+¥100.00\n×", new Date(2026, 8, 20, 20));
console.assert(importCheck.length === 2 && importCheck[0].amountCents === 1234 && importCheck[1].type === "income", "旧账单导入自检失败");

document.querySelector("#month-label").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(new Date());
renderCategories();
render();
registerWebMCP();

// 注册离线缓存；安装到主屏幕后没有网络也能打开。
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js?v=6");
