'use strict';

/**
 * XGENIA ML Coordinator Server
 * 
 * Lightweight API server that orchestrates ML operations via HuggingFace.
 * Replaces the old MindsDB + Redis stack with cloud-native HF APIs.
 */

const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { HuggingFaceMLService } = require('./hf-ml-service');

const app = express();
const port = process.env.PORT || 3001;

// Initialize HF ML service with token from environment
let mlService = new HuggingFaceMLService(process.env.HF_ACCESS_TOKEN || '');

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS for editor access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// File upload for CSV data
const upload = multer({ dest: 'uploads/' });

// ── Health Check ─────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  const tokenStatus = await mlService.validateToken();
  res.json({
    status: 'ok',
    service: 'xgenia-ml-coordinator',
    backend: 'huggingface',
    huggingface: tokenStatus
  });
});

// ── Token Management ─────────────────────────────────────────────

app.post('/hf/token', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  mlService.setToken(token);
  const validation = await mlService.validateToken();

  if (!validation.valid) {
    return res.status(401).json({ error: 'Invalid token', details: validation.error });
  }

  res.json({
    success: true,
    username: validation.username,
    plan: validation.plan
  });
});

app.get('/hf/token/validate', async (req, res) => {
  const validation = await mlService.validateToken();
  res.json(validation);
});

// ── Data Analysis ────────────────────────────────────────────────

app.post('/analyze-data', async (req, res) => {
  try {
    const { data, context } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Data must be a non-empty array of objects' });
    }

    const analysis = mlService.analyzeData(data, context || '');
    res.json(analysis);
  } catch (error) {
    console.error('[Analyze] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// File upload version of analyze
app.post('/analyze-data/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const data = await parseCsvFile(req.file.path);
    const context = req.body.context || '';
    const analysis = mlService.analyzeData(data, context);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json(analysis);
  } catch (error) {
    console.error('[Analyze Upload] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Model Training (AutoTrain) ───────────────────────────────────

app.post('/train-model', async (req, res) => {
  try {
    const { projectName, taskType, data, targetColumn, baseModel, params } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    // Step 1: Create project
    const project = await mlService.createProject({
      projectName,
      taskType: taskType || 'tabular-classification',
      baseModel,
      params
    });

    // Step 2: Upload data if provided
    if (data && Array.isArray(data)) {
      await mlService.uploadData(project.id || project.project_id, data);
    }

    // Step 3: Start training
    const training = await mlService.startTraining(project.id || project.project_id);

    res.json({
      success: true,
      projectId: project.id || project.project_id,
      projectName,
      taskType: taskType || 'tabular-classification',
      targetColumn,
      status: 'training_started',
      training
    });
  } catch (error) {
    console.error('[Train] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/train-status/:projectId', async (req, res) => {
  try {
    const status = await mlService.getProjectStatus(req.params.projectId);
    res.json(status);
  } catch (error) {
    console.error('[Train Status] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Prediction (Inference) ───────────────────────────────────────

app.post('/predict', async (req, res) => {
  try {
    const { modelRepo, inputData, endpointUrl, task, parameters } = req.body;

    if (!modelRepo && !endpointUrl) {
      return res.status(400).json({ error: 'Either modelRepo or endpointUrl is required' });
    }

    const result = await mlService.predict(
      modelRepo || '',
      inputData,
      { endpointUrl, task, parameters }
    );

    res.json(result);
  } catch (error) {
    console.error('[Predict] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Model Management ─────────────────────────────────────────────

app.get('/models', async (req, res) => {
  try {
    const models = await mlService.listModels();
    res.json(models);
  } catch (error) {
    console.error('[Models] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Client Retention Analysis ────────────────────────────────────

app.post('/client-retention/analyze', upload.single('file'), async (req, res) => {
  try {
    let data;

    if (req.file) {
      data = await parseCsvFile(req.file.path);
      fs.unlinkSync(req.file.path);
    } else if (req.body.data) {
      data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
    } else {
      return res.status(400).json({ error: 'Either upload a file or provide data in request body' });
    }

    const context = req.body.context || '';
    const analysis = mlService.analyzeRetention(data, context);

    res.json(analysis);
  } catch (error) {
    console.error('[Retention] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Utilities ────────────────────────────────────────────────────

function parseCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => results.push(row))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

// ── Start Server ─────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`[XGENIA ML Coordinator] Running on port ${port}`);
  console.log(`[XGENIA ML Coordinator] Backend: HuggingFace`);
  console.log(`[XGENIA ML Coordinator] Token: ${mlService.token ? 'configured' : 'NOT SET — use POST /hf/token or set HF_ACCESS_TOKEN env var'}`);
});
