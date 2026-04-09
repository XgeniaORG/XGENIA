#!/usr/bin/env ts-node

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface ServiceConfig {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  waitForPort?: number;
  waitForMessage?: string;
}

class AppStarter {
  private processes: Map<string, any> = new Map();
  private isShuttingDown = false;

  private services: ServiceConfig[] = [
    {
      name: 'xgenia-editor',
      cwd: path.join(__dirname, '../packages/xgenia-editor'),
      command: 'npm',
      args: ['run', 'start'],
      waitForPort: 8080,
      waitForMessage: 'Project is running at:'
    }
  ];

  async start() {
    console.log('🚀 Starting XGENIA Application Stack...\n');

    // Check if required directories exist
    for (const service of this.services) {
      if (!fs.existsSync(service.cwd)) {
        console.error(`❌ Service directory not found: ${service.cwd}`);
        process.exit(1);
      }
    }

    // Start services sequentially to ensure proper startup order
    for (const service of this.services) {
      await this.startService(service);

      // Wait for service to be ready
      if (service.waitForPort) {
        await this.waitForPort(service.waitForPort, service.name);
      }

      // Small delay between services
      await this.delay(2000);
    }

    console.log('\n✅ All services started successfully!');
    console.log('📱 XGENIA Editor should open automatically');
    console.log('🌐 Webpack Dev Server is running on port 8080');
    console.log('\nPress Ctrl+C to stop all services\n');

    // Handle graceful shutdown
    this.setupGracefulShutdown();
  }

  private async startService(service: ServiceConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`🔄 Starting ${service.name}...`);

      const options: SpawnOptions = {
        cwd: service.cwd,
        stdio: 'pipe',
        shell: true,
        env: {
          ...process.env,
          ...service.env,
          FORCE_COLOR: '1'
        }
      };

      const process = spawn(service.command, service.args, options);
      this.processes.set(service.name, process);

      let output = '';
      let isReady = false;

      process.stdout?.on('data', (data) => {
        const message = data.toString();
        output += message;

        // Log output with service prefix
        const lines = message.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          console.log(`[${service.name}] ${line}`);
        });

        // Check if service is ready
        if (service.waitForMessage && message.includes(service.waitForMessage) && !isReady) {
          isReady = true;
          console.log(`✅ ${service.name} is ready!`);
          resolve();
        }
      });

      process.stderr?.on('data', (data) => {
        const message = data.toString();
        console.error(`[${service.name}] ERROR: ${message}`);
      });

      process.on('error', (error) => {
        console.error(`❌ Failed to start ${service.name}:`, error);
        reject(error);
      });

      process.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          console.error(`❌ ${service.name} exited with code ${code}`);
        }
      });

      // If no wait message specified, resolve immediately
      if (!service.waitForMessage) {
        setTimeout(() => resolve(), 1000);
      }
    });
  }

  private async waitForPort(port: number, serviceName: string): Promise<void> {
    return new Promise((resolve) => {
      const checkPort = () => {
        const net = require('net');
        const socket = new net.Socket();

        socket.setTimeout(1000);

        socket.on('connect', () => {
          socket.destroy();
          console.log(`✅ ${serviceName} is listening on port ${port}`);
          resolve();
        });

        socket.on('timeout', () => {
          socket.destroy();
          setTimeout(checkPort, 1000);
        });

        socket.on('error', () => {
          setTimeout(checkPort, 1000);
        });

        socket.connect(port, 'localhost');
      };

      checkPort();
    });
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private setupGracefulShutdown() {
    const shutdown = () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      console.log('\n🛑 Shutting down services...');

      for (const [name, process] of this.processes) {
        console.log(`🔄 Stopping ${name}...`);
        process.kill('SIGTERM');
      }

      setTimeout(() => {
        for (const [name, process] of this.processes) {
          if (!process.killed) {
            console.log(`🔨 Force killing ${name}...`);
            process.kill('SIGKILL');
          }
        }
        process.exit(0);
      }, 5000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

// Start the application
const starter = new AppStarter();
starter.start().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});