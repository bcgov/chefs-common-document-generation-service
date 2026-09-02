FROM node:20-bookworm

ENV NO_UPDATE_NOTIFIER=true \
    PATH="/usr/lib/libreoffice/program:${PATH}" \
    PYTHONUNBUFFERED=1

RUN apt-get update || true && \
    apt-get install -y --no-install-recommends debian-archive-keyring && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install LibreOffice
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y libreoffice \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
    && apt-get clean

# Install system utilities + common fonts
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        vim \
        xauth \
        xvfb \
        wget \
        curl \
        ca-certificates \
        unzip \
        fontconfig \
        fonts-dejavu \
        fonts-liberation \
        cabextract \
    && apt-get clean

# Install Microsoft Core Fonts manually (works on ARM64)
RUN mkdir -p /usr/share/fonts/truetype/msttcorefonts && \
    cd /usr/share/fonts/truetype/msttcorefonts && \
    wget https://downloads.sourceforge.net/corefonts/arial32.exe && \
    wget https://downloads.sourceforge.net/corefonts/arialb32.exe && \
    wget https://downloads.sourceforge.net/corefonts/comic32.exe && \
    wget https://downloads.sourceforge.net/corefonts/courie32.exe && \
    wget https://downloads.sourceforge.net/corefonts/georgi32.exe && \
    wget https://downloads.sourceforge.net/corefonts/impact32.exe && \
    wget https://downloads.sourceforge.net/corefonts/times32.exe && \
    wget https://downloads.sourceforge.net/corefonts/trebuc32.exe && \
    wget https://downloads.sourceforge.net/corefonts/webdin32.exe && \
    cabextract *.exe && \
    rm *.exe && \
    fc-cache -f

# Install k6 (ARM64 or AMD64 depending on host)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then K6_ARCH="amd64"; else K6_ARCH="arm64"; fi && \
    K6_VERSION="v0.50.0" && \
    curl -L "https://github.com/grafana/k6/releases/download/${K6_VERSION}/k6-${K6_VERSION}-linux-${K6_ARCH}.tar.gz" -o /tmp/k6.tar.gz && \
    tar -xzf /tmp/k6.tar.gz -C /tmp && \
    mv /tmp/k6-${K6_VERSION}-linux-${K6_ARCH}/k6 /usr/local/bin/k6 && \
    chmod +x /usr/local/bin/k6 && \
    rm -rf /tmp/k6*

# Install helm (ARM64 or AMD64 depending on host)
# 3.17+ is required for `helm upgrade --take-ownership`; see docs/deploy-a12c97-prod.md
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then HELM_ARCH="amd64"; else HELM_ARCH="arm64"; fi && \
    HELM_VERSION="v3.21.4" && \
    curl -L "https://get.helm.sh/helm-${HELM_VERSION}-linux-${HELM_ARCH}.tar.gz" -o /tmp/helm.tar.gz && \
    tar -xzf /tmp/helm.tar.gz -C /tmp && \
    mv /tmp/linux-${HELM_ARCH}/helm /usr/local/bin/helm && \
    chmod +x /usr/local/bin/helm && \
    rm -rf /tmp/helm.tar.gz /tmp/linux-${HELM_ARCH}

# Install the OpenShift CLI (ARM64 or AMD64 depending on host)
# Tracks the mirror's `stable` channel rather than a pinned version: the cluster is upgraded
# on the platform team's schedule, and oc is expected to track it.
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then OC_ARCH="amd64"; else OC_ARCH="arm64"; fi && \
    curl -L "https://mirror.openshift.com/pub/openshift-v4/${OC_ARCH}/clients/ocp/stable/openshift-client-linux-${OC_ARCH}-rhel9.tar.gz" -o /tmp/oc.tar.gz && \
    tar -xzf /tmp/oc.tar.gz -C /usr/local/bin oc kubectl && \
    chmod +x /usr/local/bin/oc /usr/local/bin/kubectl && \
    rm -f /tmp/oc.tar.gz

# Install BC Sans font
RUN wget "https://www2.gov.bc.ca/assets/gov/british-columbians-our-governments/services-policies-for-government/policies-procedures-standards/web-content-development-guides/corporate-identity-assets/bcsansfont_print.zip?forcedownload=true" -O bcsans.zip && \
    unzip bcsans.zip && \
    rm bcsans.zip && \
    mkdir -p /usr/share/fonts/bcsans && \
    install -m 644 ./BcSansFont_Print/*.ttf /usr/share/fonts/bcsans/ && \
    rm -rf ./BcSansFont_Print && \
    fc-cache -f

# Enable PDF/UA compliance
RUN sed -i \
  's|<prop oor:name="PDFUACompliance" oor:type="xs:boolean" oor:nillable="false"><value>false</value></prop>|<prop oor:name="PDFUACompliance" oor:type="xs:boolean" oor:nillable="false"><value>true</value></prop>|' \
  /usr/lib/libreoffice/share/registry/main.xcd
