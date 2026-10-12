# SpendSense - Production Dockerfile for Render & Cloud Deployment
FROM php:8.2-cli-alpine

# Install build dependencies and required SQLite / image libraries
RUN apk add --no-cache \
    sqlite-dev \
    sqlite \
    curl-dev \
    libpng-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    libwebp-dev \
    && docker-php-ext-install pdo_sqlite

# Set working directory
WORKDIR /var/www/html

# Copy application source
COPY . /var/www/html

# Create data and uploads directories with full read/write permissions
RUN mkdir -p /var/www/html/data /var/www/html/uploads \
    && chmod -R 777 /var/www/html/data /var/www/html/uploads \
    && rm -f /var/www/html/.env

# Default Render port is 10000 (Render dynamically injects $PORT)
EXPOSE 10000

# Start PHP built-in server with required upload limits and routing through public/index.php
CMD ["sh", "-c", "php -d upload_max_filesize=12M -d post_max_size=16M -d display_errors=0 -d log_errors=1 -S 0.0.0.0:${PORT:-10000} -t public public/index.php"]
