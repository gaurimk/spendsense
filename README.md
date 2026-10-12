# SpendSense 🧾💡

**SpendSense** is an AI-powered expense assistant built with vanilla frontend technologies (HTML, CSS, ES modules), PHP 8+ PDO SQLite backend, and the Google Gemini API.

Instead of a complicated, form-heavy dashboard, SpendSense provides a **chat-first interface** where you can upload photos or PDFs of bills/receipts (supermarkets, restaurants, kiranas, pharmacies, electronics stores), have them parsed with OCR, and ask natural language questions about your spending.

---

## 🚀 Key Features

1. **Smart Bill Ingestion**:
   - Camera capture or file upload (supports JPG, PNG, WebP, and multi-page PDFs up to 3 photos).
   - In-browser image preprocessing: auto-orientation via EXIF, canvas downsampling, and JPEG compression.
   - Robust handwritten bill parsing: Devanagari numerals/names, ditto marks, shorthand amounts (`1,20/-`), and unstated payment methods left strictly as `null`.
   - Side-by-side zoomable image review and reconciliation modal.

2. **Chat With Financial Data**:
   - Ask questions like:
     - *"Where did I spend the most this month?"*
     - *"How much did I spend on snacks?"*
     - *"Which store is cheaper for milk?"*
     - *"Compare this month with last month"*
     - *"Am I spending a lot?"*
     - *"Show my reminders"*
     - *"What are my recurring expenses?"*
   - Powered by Gemini function calling with strict PHP query whitelisting and multi-tenant isolation.
   - Built-in heuristic fallback query parser ensures chat queries work even if Gemini API quota is reached.

3. **Analytics & Budgeting**:
   - **Insights Dashboard**: Total monthly spend, category donut chart, monthly trendline, top merchants, top items, average bill size, and accuracy logs for printed vs. handwritten bills.
   - **Bills Tab**: Searchable and filterable archive with click-to-inspect line items, original image attachment viewer, and bill deletion.
   - **Budgets Tab**: Category monthly budgets with progress bars and 80%/100% threshold alert notifications.

4. **Advanced Stage 5 Features**:
   - **Price Tracker**: Multi-store item price comparison chart, cheapest merchant badge, and inflation/deflation tracker.
   - **Reminders**: Warranty and return deadline management with automated suggestions for electronics and apparel bills.
   - **Recurring Spend**: Detects repeat purchases (milk, subscriptions, rent, fuel) with estimated monthly costs and next expected dates.
   - **Split a Bill**: Mark items as *Mine (100%)*, *Shared (50%)*, or *Someone else's (0%)*; Insights strictly counts your share.
   - **Settings & Privacy**: Add/rename/delete categories, export bills and line items to CSV, and one-click data deletion safeguard.

---

## 🛠️ Stack & Requirements

- **Backend**: PHP 8.1+ with PDO SQLite and cURL extensions (no frameworks, pure PHP).
- **Database**: SQLite in `/data/spendsense.sqlite`.
- **Frontend**: Plain HTML5, CSS3, Vanilla JavaScript (ES modules), Chart.js (CDN).
- **AI**: Google Gemini API (`gemini-3.8-flash`).

---

## 💻 Local Development

1. Clone or navigate to the directory:
   ```bash
   cd spendsense
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   Add your Gemini API key in `.env`:
   ```ini
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-3.8-flash
   GEMINI_MODEL_HANDWRITTEN=gemini-3.8-flash
   ```

3. Start the local PHP development server:
   ```bash
   php -d upload_max_filesize=12M -d post_max_size=16M -d display_errors=0 -d log_errors=1 -S localhost:8000 -t public public/index.php
   ```

4. Open `http://localhost:8000` in your browser.

5. Run the test suite:
   ```bash
   php tests/test_cli.php
   ```

---

## 🌐 Deploying to GitHub and Render

### Step 1: Push to GitHub

1. Initialize git and commit your files:
   ```bash
   cd spendsense
   git init
   git add .
   git commit -m "Initial commit of SpendSense"
   ```

2. Create a new repository on [GitHub](https://github.com/new) (e.g. named `spendsense`).

3. Link and push your repository:
   ```bash
   git remote add origin https://github.com/<your-username>/spendsense.git
   git branch -M main
   git push -u origin main
   ```

---

### Step 2: Deploy on Render

#### Option A: 1-Click Blueprint Deploy (Recommended)
Because this repository includes `render.yaml`, Render can configure everything automatically:
1. Log into [Render](https://dashboard.render.com).
2. Click **New +** > **Blueprint**.
3. Connect your GitHub repository (`spendsense`).
4. Enter your `GEMINI_API_KEY` when prompted.
5. Click **Apply**. Render will build the Docker container and start your service!

#### Option B: Manual Web Service Setup
1. Log into [Render](https://dashboard.render.com).
2. Click **New +** > **Web Service**.
3. Choose **Build and deploy from a Git repository** and select `spendsense`.
4. Configure the settings:
   - **Name**: `spendsense`
   - **Region**: Oregon, Frankfurt, or Singapore
   - **Language / Runtime**: **Docker**
   - **Plan**: **Free**
5. Under **Environment Variables**, add:
   - `GEMINI_API_KEY`: *(Your Google Gemini API Key)*
   - `GEMINI_MODEL`: `gemini-3.8-flash`
   - `GEMINI_MODEL_HANDWRITTEN`: `gemini-3.8-flash`
   - `SESSION_SECRET`: *(A random 32+ character string)*
6. Click **Deploy Web Service**.

Your SpendSense instance will be live at `https://spendsense-xxxx.onrender.com`!

---

### 💾 Persistent Storage on Render (Optional)
On Render's Free tier, the filesystem is ephemeral (resets on restart or new deploy). To keep bills and database permanently on Render:
1. Upgrade to a paid instance ($7/month).
2. Under your Web Service, go to **Disks** > **Add Disk**.
3. Mount Path: `/var/data` (Size: 1 GB).
4. Add environment variables:
   - `DATA_DIR`: `/var/data`
   - `UPLOADS_DIR`: `/var/data/uploads`

---

## 🧪 Testing

SpendSense includes an automated CLI test suite covering all functionality (authentication, database schema, multi-tenant isolation, Gemini OCR, arithmetic validation, category learning, price tracking, reminders, split bills, and whitelist query execution):

```bash
php tests/test_cli.php
```
Result: **190 tests passed, 0 failed**.
