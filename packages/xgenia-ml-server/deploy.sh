#!/bin/bash

# XGENIA ML Server Deployment Script
# This script sets up the complete AI-powered ML system

set -e

echo "🚀 Starting XGENIA ML Server Deployment..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "📦 Pulling latest images..."
docker-compose pull

echo "🏗️ Building ML Coordinator..."
docker-compose build ml-coordinator

echo "🚀 Starting ML services..."
docker-compose up -d

echo "⏳ Waiting for services to be ready..."
sleep 30

# Health check
echo "🔍 Checking service health..."
if curl -f http://localhost:47334/api/status &>/dev/null; then
    echo "✅ MindsDB is running on port 47334"
else
    echo "❌ MindsDB health check failed"
    exit 1
fi

if curl -f http://localhost:3001/health &>/dev/null; then
    echo "✅ ML Coordinator is running on port 3001"
else
    echo "❌ ML Coordinator health check failed"
    exit 1
fi

echo ""
echo "🎉 XGENIA ML Server is now running!"
echo ""
echo "📊 Services:"
echo "   • MindsDB (Auto-ML Engine): http://localhost:47334"
echo "   • MindsDB GUI: http://localhost:47335"
echo "   • ML Coordinator API: http://localhost:3001"
echo "   • Redis: localhost:6379"
echo ""
echo "🛠️ Next Steps:"
echo "   1. Use the ML nodes in your XGENIA graphs"
echo "   2. Connect your data sources"
echo "   3. Let the AI build your ML applications!"
echo ""
echo "📖 See README.md for usage examples"



