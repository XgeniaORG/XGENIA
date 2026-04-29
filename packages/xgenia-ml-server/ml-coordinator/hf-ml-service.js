'use strict';

/**
 * HuggingFace ML Service
 * 
 * Unified service wrapping HuggingFace APIs (Inference + AutoTrain)
 * Replaces the MindsDB-based ML system with cloud HuggingFace.
 */

const axios = require('axios');

const HF_API_BASE = 'https://huggingface.co/api';
const HF_INFERENCE_BASE = 'https://api-inference.huggingface.co';
const HF_AUTOTRAIN_BASE = 'https://huggingface.co/api/autotrain';

class HuggingFaceMLService {
    constructor(token) {
        this.token = token;
        this.headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    }

    setToken(token) {
        this.token = token;
        this.headers['Authorization'] = `Bearer ${token}`;
    }

    // ── Data Analysis ──────────────────────────────────────────────

    /**
     * Analyze data structure, detect types, suggest ML approach.
     * Uses intelligent heuristics + returns structured analysis.
     */
    analyzeData(data, context = '') {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('Data must be a non-empty array of objects');
        }

        const columns = Object.keys(data[0] || {});
        const sampleSize = Math.min(data.length, 200);
        const sample = data.slice(0, sampleSize);

        const columnAnalysis = {};
        columns.forEach(col => {
            const values = sample.map(row => row[col]).filter(v => v !== null && v !== undefined && v !== '');
            const nullCount = sample.length - values.length;

            columnAnalysis[col] = {
                type: this._detectColumnType(values),
                uniqueValues: new Set(values).size,
                nullCount,
                nullPercentage: Math.round((nullCount / sample.length) * 100),
                sample: values.slice(0, 5)
            };
        });

        // Intelligent problem type detection
        const problemType = this._detectProblemType(columnAnalysis, context);
        const targetColumn = this._suggestTargetColumn(columns, columnAnalysis, context);
        const features = columns.filter(c => c !== targetColumn);

        // Data quality assessment
        const qualityIssues = this._assessDataQuality(columnAnalysis, data.length);

        // Suggest HuggingFace task type
        const hfTaskType = this._mapToHfTaskType(problemType, columnAnalysis);

        return {
            totalRows: data.length,
            totalColumns: columns.length,
            columns: columnAnalysis,
            problemType,
            suggestedTarget: targetColumn,
            suggestedFeatures: features,
            hfTaskType,
            qualityIssues,
            recommendations: this._generateRecommendations(problemType, columnAnalysis, qualityIssues),
            preprocessingSteps: this._suggestPreprocessing(columnAnalysis)
        };
    }

    _detectColumnType(values) {
        if (values.length === 0) return 'unknown';

        const numericCount = values.filter(v => !isNaN(Number(v)) && v !== '').length;
        const booleanCount = values.filter(v =>
            typeof v === 'boolean' || ['true', 'false', '0', '1', 'yes', 'no'].includes(String(v).toLowerCase())
        ).length;
        const dateCount = values.filter(v => {
            const d = new Date(v);
            return !isNaN(d.getTime()) && String(v).length > 4;
        }).length;

        const ratio = values.length > 0 ? 1 : 0;
        if (booleanCount / values.length > 0.8) return 'boolean';
        if (dateCount / values.length > 0.8) return 'date';
        if (numericCount / values.length > 0.8) return 'numeric';

        const avgLength = values.reduce((sum, v) => sum + String(v).length, 0) / values.length;
        if (avgLength > 50) return 'text';

        return 'categorical';
    }

    _detectProblemType(columnAnalysis, context) {
        const ctx = context.toLowerCase();
        const columns = Object.entries(columnAnalysis);

        // Context-based detection
        if (ctx.includes('churn') || ctx.includes('retention')) return 'classification';
        if (ctx.includes('forecast') || ctx.includes('predict price') || ctx.includes('revenue')) return 'regression';
        if (ctx.includes('time series') || ctx.includes('trend')) return 'time_series';
        if (ctx.includes('classify') || ctx.includes('category') || ctx.includes('sentiment')) return 'classification';
        if (ctx.includes('cluster') || ctx.includes('segment') || ctx.includes('group')) return 'clustering';
        if (ctx.includes('text') || ctx.includes('nlp') || ctx.includes('language')) return 'text_classification';
        if (ctx.includes('image') || ctx.includes('vision') || ctx.includes('photo')) return 'image_classification';

        // Data-driven detection
        const boolCols = columns.filter(([_, info]) => info.type === 'boolean');
        const categoricalCols = columns.filter(([_, info]) => info.type === 'categorical' && info.uniqueValues <= 10);
        const dateCols = columns.filter(([_, info]) => info.type === 'date');
        const textCols = columns.filter(([_, info]) => info.type === 'text');
        const numericCols = columns.filter(([_, info]) => info.type === 'numeric');

        if (textCols.length > 0 && categoricalCols.length > 0) return 'text_classification';
        if (boolCols.length > 0) return 'classification';
        if (dateCols.length > 0 && numericCols.length > 0) return 'time_series';
        if (categoricalCols.length > 0 && categoricalCols.some(([name]) =>
            /label|class|category|type|target|status/i.test(name)
        )) return 'classification';
        if (numericCols.length > columns.length * 0.7) return 'regression';

        return 'classification'; // Safe default
    }

    _suggestTargetColumn(columns, columnAnalysis, context) {
        const ctx = context.toLowerCase();

        // Context-based suggestions
        const contextKeywords = {
            'churn': ['churn', 'churned', 'is_churn', 'will_churn'],
            'retention': ['retained', 'active', 'is_active'],
            'sentiment': ['sentiment', 'label', 'rating'],
            'price': ['price', 'cost', 'amount', 'revenue'],
            'classify': ['label', 'class', 'category', 'type']
        };

        for (const [keyword, candidates] of Object.entries(contextKeywords)) {
            if (ctx.includes(keyword)) {
                const match = columns.find(col =>
                    candidates.some(c => col.toLowerCase().includes(c))
                );
                if (match) return match;
            }
        }

        // Pattern-based suggestions
        const targetPatterns = /^(target|label|class|category|outcome|result|prediction|y|output)/i;
        const match = columns.find(col => targetPatterns.test(col));
        if (match) return match;

        // Boolean or low-cardinality categorical columns are likely targets
        const boolCol = columns.find(col => columnAnalysis[col]?.type === 'boolean');
        if (boolCol) return boolCol;

        const lowCardCat = columns.find(col =>
            columnAnalysis[col]?.type === 'categorical' && columnAnalysis[col]?.uniqueValues <= 5
        );
        if (lowCardCat) return lowCardCat;

        // Default to last column
        return columns[columns.length - 1];
    }

    _assessDataQuality(columnAnalysis, totalRows) {
        const issues = [];

        for (const [col, info] of Object.entries(columnAnalysis)) {
            if (info.nullPercentage > 30) {
                issues.push({ column: col, issue: 'high_null_rate', detail: `${info.nullPercentage}% null values` });
            }
            if (info.uniqueValues === 1) {
                issues.push({ column: col, issue: 'constant_value', detail: 'Column has only one unique value' });
            }
            if (info.type === 'categorical' && info.uniqueValues > totalRows * 0.8) {
                issues.push({ column: col, issue: 'high_cardinality', detail: `${info.uniqueValues} unique values — likely an ID column` });
            }
        }

        if (totalRows < 100) {
            issues.push({ column: null, issue: 'small_dataset', detail: `Only ${totalRows} rows — may not be enough for reliable ML` });
        }

        return issues;
    }

    _mapToHfTaskType(problemType, columnAnalysis) {
        const mapping = {
            'classification': 'tabular-classification',
            'regression': 'tabular-regression',
            'text_classification': 'text-classification',
            'image_classification': 'image-classification',
            'time_series': 'tabular-regression',
            'clustering': 'tabular-classification'
        };
        return mapping[problemType] || 'tabular-classification';
    }

    _generateRecommendations(problemType, columnAnalysis, qualityIssues) {
        const recs = [];

        if (qualityIssues.some(i => i.issue === 'high_null_rate')) {
            recs.push('Handle missing values before training — consider imputation or dropping columns with >50% nulls');
        }
        if (qualityIssues.some(i => i.issue === 'high_cardinality')) {
            recs.push('Remove high-cardinality ID columns that don\'t contribute to predictions');
        }
        if (qualityIssues.some(i => i.issue === 'small_dataset')) {
            recs.push('Consider using pre-trained models from HuggingFace Hub instead of training from scratch');
        }

        const taskRecs = {
            'classification': 'Use HuggingFace AutoTrain for tabular classification — it handles model selection automatically',
            'regression': 'Use AutoTrain for tabular regression or try a pre-trained model fine-tuned on similar data',
            'text_classification': 'Consider using a pre-trained BERT/RoBERTa model with fine-tuning via AutoTrain',
            'image_classification': 'Use AutoTrain image classification with a pre-trained vision model',
            'time_series': 'For time series, consider tabular regression with engineered time features',
            'clustering': 'For clustering, use HF Inference API with a suitable embedding model, then cluster locally'
        };

        recs.push(taskRecs[problemType] || taskRecs['classification']);
        return recs;
    }

    _suggestPreprocessing(columnAnalysis) {
        const steps = [];
        const columns = Object.entries(columnAnalysis);

        if (columns.some(([_, info]) => info.nullCount > 0)) {
            steps.push({ step: 'handle_missing', description: 'Fill or remove missing values' });
        }
        if (columns.some(([_, info]) => info.type === 'categorical')) {
            steps.push({ step: 'encode_categorical', description: 'Encode categorical variables (label or one-hot encoding)' });
        }
        if (columns.some(([_, info]) => info.type === 'text')) {
            steps.push({ step: 'tokenize_text', description: 'Tokenize text columns for NLP processing' });
        }
        if (columns.some(([_, info]) => info.type === 'date')) {
            steps.push({ step: 'extract_date_features', description: 'Extract year, month, day, dayOfWeek from date columns' });
        }
        if (columns.some(([name, info]) => info.type === 'numeric' && info.uniqueValues === columns.length)) {
            steps.push({ step: 'remove_ids', description: 'Remove ID/index columns that don\'t contribute to predictions' });
        }

        return steps;
    }

    // ── AutoTrain Integration ──────────────────────────────────────

    /**
     * Create a new AutoTrain project on HuggingFace
     */
    async createProject(config) {
        const { projectName, taskType, baseModel, params } = config;

        const response = await axios.post(`${HF_AUTOTRAIN_BASE}/create_project`, {
            project_name: projectName,
            task: taskType || 'tabular-classification',
            base_model: baseModel || 'autotrain',
            params: params || {}
        }, { headers: this.headers });

        return response.data;
    }

    /**
     * Upload training data to an AutoTrain project
     */
    async uploadData(projectId, data, filename = 'train.csv') {
        const FormData = require('form-data');
        const form = new FormData();

        // Convert data array to CSV
        if (Array.isArray(data)) {
            const csvContent = this._arrayToCsv(data);
            form.append('files', Buffer.from(csvContent), { filename, contentType: 'text/csv' });
        } else if (typeof data === 'string') {
            // Assume it's already CSV content
            form.append('files', Buffer.from(data), { filename, contentType: 'text/csv' });
        }

        const response = await axios.post(
            `${HF_AUTOTRAIN_BASE}/${projectId}/upload`,
            form,
            {
                headers: {
                    ...this.headers,
                    ...form.getHeaders()
                }
            }
        );
        return response.data;
    }

    /**
     * Start training for an AutoTrain project
     */
    async startTraining(projectId) {
        const response = await axios.post(
            `${HF_AUTOTRAIN_BASE}/${projectId}/start`,
            {},
            { headers: this.headers }
        );
        return response.data;
    }

    /**
     * Check the status of an AutoTrain project
     */
    async getProjectStatus(projectId) {
        const response = await axios.get(
            `${HF_AUTOTRAIN_BASE}/${projectId}`,
            { headers: this.headers }
        );
        return response.data;
    }

    // ── Inference ──────────────────────────────────────────────────

    /**
     * Run inference against a HuggingFace model (serverless or dedicated endpoint)
     */
    async predict(modelRepo, inputData, options = {}) {
        const { endpointUrl, task } = options;

        // Use dedicated endpoint if provided, otherwise serverless
        const url = endpointUrl || `${HF_INFERENCE_BASE}/models/${modelRepo}`;

        const response = await axios.post(url, {
            inputs: inputData,
            parameters: options.parameters || {}
        }, {
            headers: this.headers,
            timeout: 120000 // 2 minute timeout for cold starts
        });

        return {
            prediction: response.data,
            model: modelRepo,
            mode: endpointUrl ? 'endpoint' : 'serverless'
        };
    }

    // ── Model Management ───────────────────────────────────────────

    /**
     * List user's models on HuggingFace
     */
    async listModels() {
        try {
            const response = await axios.get(`${HF_API_BASE}/models`, {
                headers: this.headers,
                params: {
                    author: await this._getUsername(),
                    limit: 50
                }
            });
            return response.data.map(model => ({
                id: model.id || model.modelId,
                name: model.id?.split('/').pop() || model.modelId,
                task: model.pipeline_tag || 'unknown',
                lastModified: model.lastModified,
                downloads: model.downloads || 0,
                likes: model.likes || 0
            }));
        } catch (error) {
            console.error('[HF ML Service] Error listing models:', error.message);
            return [];
        }
    }

    /**
     * Validate the current token
     */
    async validateToken() {
        try {
            const response = await axios.get(`${HF_API_BASE}/whoami-v2`, {
                headers: this.headers
            });
            return {
                valid: true,
                username: response.data.name || response.data.fullname,
                email: response.data.email,
                plan: response.data.plan || 'free'
            };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    async _getUsername() {
        try {
            const response = await axios.get(`${HF_API_BASE}/whoami-v2`, {
                headers: this.headers
            });
            return response.data.name;
        } catch {
            return 'unknown';
        }
    }

    // ── Retention Analysis ─────────────────────────────────────────

    /**
     * AI-powered client retention analysis
     * Replaces the hardcoded retention analysis from the old ML server
     */
    analyzeRetention(data, context = '') {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('Retention data must be a non-empty array');
        }

        const totalClients = data.length;

        // Detect churn column
        const columns = Object.keys(data[0]);
        const churnCol = columns.find(c => /churn|churned|is_active|retained|left|cancelled/i.test(c));

        let churnRate = 0;
        let riskFactors = [];
        let atRiskClients = [];

        if (churnCol) {
            const churned = data.filter(row => {
                const val = row[churnCol];
                return val === true || val === 1 || val === '1' ||
                    String(val).toLowerCase() === 'true' ||
                    String(val).toLowerCase() === 'yes' ||
                    String(val).toLowerCase() === 'churned';
            });
            churnRate = Math.round((churned.length / totalClients) * 100);

            // Identify contributing factors
            riskFactors = this._identifyRiskFactors(data, churnCol);
            atRiskClients = this._identifyAtRiskClients(data, churnCol, riskFactors);
        }

        return {
            insights: {
                totalClients,
                churnRate,
                riskFactors,
                atRiskClients: atRiskClients.length,
                recommendations: this._generateRetentionRecommendations(churnRate, riskFactors)
            },
            suggestedModel: {
                type: 'churn_prediction',
                targetColumn: churnCol || 'churn',
                hfTaskType: 'tabular-classification',
                features: columns.filter(c => c !== churnCol)
            }
        };
    }

    _identifyRiskFactors(data, churnCol) {
        const factors = [];
        const columns = Object.keys(data[0]).filter(c => c !== churnCol);
        const churned = data.filter(row => {
            const val = row[churnCol];
            return val === true || val === 1 || val === '1' ||
                String(val).toLowerCase() === 'true' ||
                String(val).toLowerCase() === 'yes' ||
                String(val).toLowerCase() === 'churned';
        });
        const retained = data.filter(row => !churned.includes(row));

        columns.forEach(col => {
            const churnedVals = churned.map(r => r[col]).filter(v => v !== null && v !== undefined);
            const retainedVals = retained.map(r => r[col]).filter(v => v !== null && v !== undefined);

            // Numeric comparison
            const churnedNum = churnedVals.filter(v => !isNaN(Number(v))).map(Number);
            const retainedNum = retainedVals.filter(v => !isNaN(Number(v))).map(Number);

            if (churnedNum.length > 0 && retainedNum.length > 0) {
                const churnedAvg = churnedNum.reduce((a, b) => a + b, 0) / churnedNum.length;
                const retainedAvg = retainedNum.reduce((a, b) => a + b, 0) / retainedNum.length;
                const diff = Math.abs(churnedAvg - retainedAvg);
                const maxAvg = Math.max(Math.abs(churnedAvg), Math.abs(retainedAvg), 1);

                if (diff / maxAvg > 0.15) {
                    factors.push({
                        column: col,
                        type: 'numeric_difference',
                        churnedAvg: Math.round(churnedAvg * 100) / 100,
                        retainedAvg: Math.round(retainedAvg * 100) / 100,
                        significance: Math.round((diff / maxAvg) * 100) / 100
                    });
                }
            }
        });

        return factors.sort((a, b) => b.significance - a.significance).slice(0, 5);
    }

    _identifyAtRiskClients(data, churnCol, riskFactors) {
        if (riskFactors.length === 0) return [];

        return data.filter(row => {
            const val = row[churnCol];
            const isChurned = val === true || val === 1 || val === '1' ||
                String(val).toLowerCase() === 'true' ||
                String(val).toLowerCase() === 'yes' ||
                String(val).toLowerCase() === 'churned';
            if (isChurned) return false; // Already churned

            // Score based on risk factors
            let riskScore = 0;
            riskFactors.forEach(factor => {
                const value = Number(row[factor.column]);
                if (!isNaN(value)) {
                    // Check if value is closer to churned average
                    const distToChurn = Math.abs(value - factor.churnedAvg);
                    const distToRetained = Math.abs(value - factor.retainedAvg);
                    if (distToChurn < distToRetained) riskScore++;
                }
            });

            return riskScore >= Math.ceil(riskFactors.length / 2);
        });
    }

    _generateRetentionRecommendations(churnRate, riskFactors) {
        const recs = [];

        if (churnRate > 20) {
            recs.push('High churn rate detected — immediate intervention recommended');
        }
        if (churnRate > 10) {
            recs.push('Train a churn prediction model to identify at-risk clients before they leave');
        }

        riskFactors.forEach(factor => {
            if (factor.significance > 0.3) {
                recs.push(`Monitor "${factor.column}" — significant difference between churned (avg: ${factor.churnedAvg}) and retained (avg: ${factor.retainedAvg}) clients`);
            }
        });

        if (recs.length === 0) {
            recs.push('Churn rate appears healthy. Consider regular monitoring with automated ML predictions.');
        }

        return recs;
    }

    // ── Utilities ──────────────────────────────────────────────────

    _arrayToCsv(data) {
        if (!Array.isArray(data) || data.length === 0) return '';
        const headers = Object.keys(data[0]);
        const rows = data.map(row =>
            headers.map(h => {
                const val = row[h];
                if (val === null || val === undefined) return '';
                const str = String(val);
                return str.includes(',') || str.includes('"') || str.includes('\n')
                    ? `"${str.replace(/"/g, '""')}"`
                    : str;
            }).join(',')
        );
        return [headers.join(','), ...rows].join('\n');
    }
}

module.exports = { HuggingFaceMLService };
