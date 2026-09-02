# Dev Container Setup for Common Document Generation Service (CDOGS)

This dev container provides a fully configured development environment for the Common Document Generation Service (CDOGS), a Node.js application that uses Carbone Enterprise Edition for document templating and generation.

## Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/)
- [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) for VS Code
- [Docker](https://www.docker.com/get-started) installed and running on your host machine
- A valid Carbone Enterprise Edition license key — **only** if you intend to run Carbone
  locally (see step 2)

## Setup Instructions

1. **Clone the Repository**

   ```bash
   git clone <repository-url>
   cd common-document-generation-service
   ```

2. **Obtain Carbone License** *(optional — needed only to run Carbone locally)*
   - Place your Carbone Enterprise Edition license key in a file named `carbone-license.txt`
   - Save this file in the `.devcontainer/cdogs_local/` directory

   The container builds and finishes setup without it; the post-install script prints a
   warning rather than failing. Without the license you can still edit code, run unit tests
   and load tests, and work with the Helm charts — you just cannot start the local Carbone
   service, so document rendering will not work.

   > **Deploying to OpenShift?** You do not need a local license file. The Carbone EE license
   > lives in the cluster as the `carbone-license` secret in the target namespace, and the
   > chart reads it from there — it is never created or supplied by the chart itself. So if
   > you are only using this container to run `helm upgrade` against OpenShift, skip this
   > step entirely. See [docs/deploy-a12c97-prod.md](../docs/deploy-a12c97-prod.md).

3. **Open in VS Code**
   - Open the cloned repository in Visual Studio Code
   - When prompted, click "Reopen in Container" or use Command Palette: `Dev Containers: Reopen in Container`

4. **Wait for Setup**
   - The dev container will build automatically (this may take several minutes on first run)
   - The post-install script will install Node.js dependencies and configure the environment

## What's Included

This dev container provides:

- **Node.js 20.18.3** with npm for running the CDOGS application
- **LibreOffice** with full font support for document processing
- **Microsoft Core Fonts** and BC Sans fonts for consistent document rendering
- **k6** load testing tool for performance testing
- **helm** and the **OpenShift CLI** (`oc`, `kubectl`) for deploying to OpenShift
- **Docker-in-Docker** support for running containerized services
- **Git** for version control
- **ESLint** and **Prettier** extensions for code quality
- Pre-configured ports:
  - `3000`: CDOGS application server
  - `4000`: Carbone Enterprise Edition service

## Running the Application

Once the dev container is ready:

1. **Start Carbone Service** (if not auto-started):

   ```bash
   cd .devcontainer/cdogs_local
   docker-compose up -d carbone
   ```

2. **Start CDOGS Application**:

   ```bash
   cd app
   npm start
   ```

3. **Access the Application**:
   - Open http://localhost:3000 in your browser for the CDOGS API
   - Carbone service runs on http://localhost:4000

## Development Workflow

- **Code Editing**: Use VS Code with ESLint and Prettier for automatic formatting
- **Testing**: Run unit tests with `npm test` in the `app` directory
- **Load Testing**: Use k6 scripts in the `k6` directory for performance testing
- **API Documentation**: View OpenAPI specs in `app/src/docs/v2.api-spec.yaml`

## Configuration

- Local configuration is managed in `.devcontainer/cdogs_local/local.json`
- Environment variables are set via `NODE_CONFIG_DIR` pointing to the local config directory
- Docker volumes are mounted for template and render directories

## Troubleshooting

- **Build Issues**: Ensure Docker is running and you have sufficient disk space
- **License Warning on Startup**: Expected if you have not added `carbone-license.txt`. Setup
  still completes; add the file and run `docker compose -f .devcontainer/cdogs_local/docker-compose.yml up -d`
  when you need the local Carbone service. Not required for OpenShift deployments.
- **License Errors from Carbone**: Verify `carbone-license.txt` contains a valid Carbone EE license
- **Port Conflicts**: Check that ports 3000 and 4000 are available on your host
- **Permission Issues**: The post-install script sets executable permissions on shell scripts

## Deploying to OpenShift

`helm` and `oc` are installed in the container. See
[docs/deploy-a12c97-prod.md](../docs/deploy-a12c97-prod.md) for the deployment runbook.

## Additional Resources

- [CDOGS Main README](../README.md)
- [Carbone Documentation](https://carbone.io/documentation.html)
- [k6 Documentation](https://k6.io/docs/)
- [Dev Containers Documentation](https://code.visualstudio.com/docs/devcontainers/containers)
