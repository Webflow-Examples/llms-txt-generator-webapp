# LLMS.TXT Generator

A [Webflow Cloud](https://webflow.com/cloud) app that automatically generates `llms.txt` files containing links to markdown pages for live pages and collections on your Webflow site. You can choose which pages and collections to include in your `llms.txt` file.

## Table of contents

1. [Project description](#project-description)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Project dependencies](#project-dependencies)
5. [Getting Started](#getting-started)
6. [Deploy to Webflow Cloud](#deploy-to-webflow-cloud)
7. [Troubleshooting](#troubleshooting)
8. [Contributing guidelines](#contributing-guidelines)
9. [Additional documentation](#additional-documentation)
10. [How to get help](#how-to-get-help)

## Project description

With _LLMS.TXT Generator_ you can automatically create structured documentation from your Webflow content that's optimized for Large Language Model (LLM) consumption. The app helps you expose selected pages and collections from your Webflow site as clean, markdown-formatted documentation accessible via a standardized `llms.txt` endpoint.

This project is intended for **Webflow site owners and developers** who want to **make their site content accessible to LLMs and AI tools** through a standardized documentation format.

## ✨ Features

- **Selective Content Exposure**: Choose which pages and collections to include in your documentation
- **Automatic Markdown Conversion**: Clean conversion of Webflow content to structured markdown
- **Admin Interface**: User-friendly interface for managing exposed content

## 🛠️ Tech Stack

- **Webflow Cloud** - Infrastructure for hosting the webapp alongside a Webflow site
- **Astro** - Fullstack web application framework
- **Webflow Data APIs** - Content source and site management
- **KV Storage** - Persistent storage for content and settings

## Project dependencies

Before using LLMS.TXT Generator, ensure you have:

- Node.js 18+ installed
- npm package manager
- Git version control
- Webflow account ([sign up](https://webflow.com/signup) for free)
- Webflow CLI installed (`npm install -g @webflow/webflow-cli`)
- A Webflow site with content to expose

## Getting Started

Get started with LLMS.TXT Generator by forking this repository and setting up your local development environment.

### Install the project

1. **Fork and clone the repository**

   [Fork this repo](https://github.com/Webflow-Examples/llms-txt-generator-webapp/fork) into your own repositories so you have a copy to work with. Clone the repo down to your local machine

   ```bash
   git clone https://github.com/your-username/llms-txt-generator-webapp.git
   cd llms-txt-generator-webapp
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

### Configure environment variables

1. **Generate a Webflow Site API Token**

   Navigate to your Webflow site settings:

   - Go to Site Settings → Apps & Integrations
   - In the "API access" section, click "Generate API token"
   - Choose a name, ensure it has the following scopes:
     - Authorized user - Read-only
     - CMS - Read and write
     - Pages - Read and write
     - Sites - Read and write
   - Generate and save the token for step 2 (you cannot retrieve it later)

   _Note: Only users with Adnub access (or higher) can generate an API token._

2. **Set up environment variables**

   Duplicate `.env.example` and rename to `.env` and fill in the values for both of these new duplicated files:

   ```bash
   cp .env.example .env
   ```

   Add your configuration:

   ```
   WEBFLOW_SITE_ID=your_site_id_here
   WEBFLOW_SITE_API_TOKEN=your_api_token_here
   DOMAIN=your-domain.webflow.io
   ```

   - Find your `WEBFLOW_SITE_ID` in Site Settings → General → Overview
   - Set `WEBFLOW_SITE_API_TOKEN` to the token value from step 1
   - Set `DOMAIN` to your site's domain (can be the webflow staging domain or the custom domain your site is published on)

   Now duplicate `.dev.vars.template` and rename it to `.dev.vars` and fill in the same values as above. In local development, `.env` will be used when running the app outside of `wrangler dev`.

### Run the app locally

1. **Start the development server**

   ```bash
   npm run dev
   ```

   The development server will start and show you the local URL.

2. **Access the admin interface**

   Open [http://localhost:4321/llmstxt](http://localhost:4321/llmstxt) in your browser to see the admin interface.

3. **Configure content exposure**

   - Navigate to "Manage Collections" to select which collections to expose
   - Navigate to "Manage Pages" to select which pages to expose
   - Click "Regenerate llms.txt" to generate your documentation

4. **View generated documentation**

   Visit [http://localhost:4321/llmstxt/llms.txt](http://localhost:4321/llmstxt/llms.txt) to see your generated documentation.

## 🚀 Deploy to Webflow Cloud

Once everything works locally, you can deploy the app to your Webflow site with Webflow Cloud. Push any local changes made to your local project up to your remote branch first.

### Create Webflow Cloud app

> For detailed guidance, see the [Webflow Cloud documentation](https://developers.webflow.com/webflow-cloud/bring-your-own-app).

1. **Connect GitHub to Webflow**

   In your Webflow site settings:

   - Navigate to the **Webflow Cloud** tab
   - Click "Install GitHub App" and follow prompts
   - Grant Webflow access to your forked repository

2. **Create the project**

   - Click "Create New Project" in Webflow Cloud
   - Enter your project name and GitHub repository location
   - When creating an **Environment**:
     - **Branch**: Select your working branch (usually `main`)
     - **Mount Path**: Enter `/llmstxt`
   - You will need to re-publish your Webflow site at this time

3. **Add environment variables**

   In the **Deployments** page:

   - Open the "Environment Variables" tab
   - Add all variables from your `.env` file
   - These ensure your deployed app can access the configuration

4. **Deploy the app**

   - Click "Deploy latest commit"
   - After deployment completes, click the URL under "Environment URL"
   - You should see your app running at `https://your-site.webflow.io/llmstxt`

## Troubleshooting

<table>
  <tr>
   <td><strong>Issue</strong></td>
   <td><strong>Solution</strong></td>
  </tr>
  <tr>
   <td>Environment variables not working</td>
   <td>Ensure you have both <code>WEBFLOW_SITE_API_TOKEN</code> and <code>WEBFLOW_SITE_ID</code> set for development, and all variables properly configured in Webflow Cloud for production.</td>
  </tr>
  <tr>
   <td>No content appears in llms.txt</td>
   <td>Make sure you've selected pages/collections to expose in the admin interface and clicked "Regenerate llms.txt".</td>
  </tr>
  <tr>
   <td>Build fails during deployment</td>
   <td>Check the "Deployment History" in Webflow Cloud for detailed error logs. Ensure all environment variables are properly set. Also check "Runtime Logs" for any errors that stick out.</td>
  </tr>
</table>

**Other troubleshooting resources:**

- Check browser console for JavaScript errors
- Verify Webflow API token has correct permissions
- Ensure your Webflow site has published content

## Contributing guidelines

Feel free to submit issues and enhancement requests!

For major changes:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request to the original repo in `Webflow-Examples` with a clear description of the change

## Additional documentation

For more information:

- [Webflow Cloud Documentation](https://developers.webflow.com/webflow-cloud)
- [Webflow API Reference](https://developers.webflow.com/reference)
- [Astro Documentation](https://docs.astro.build)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers)

## How to get help

- [Open an issue](https://github.com/Webflow-Examples/llms-txt-generator-webapp/issues) on GitHub
- [Webflow Community Forum](https://forum.webflow.com)
