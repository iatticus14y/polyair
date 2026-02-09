// Name: Polyair
// ID: polyair
// Description: GPU-accelerated rendering with high-resolution pen, 3D models, and advanced effects
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Polyair extension must be run unsandboxed");
  }

  class PolyairExtension {
    constructor() {
      // WebGL setup
      this.glCanvas = null;
      this.gl = null;
      this.resolution = { width: 854, height: 480 }; // Default 480p
      this.targetResolution = '480p';
      
      // GPU sprite tracking
      this.gpuSprites = new Set();
      
      // Shader programs
      this.shaderProgram = null;
      this.programInfo = null;
      
      // Pen state
      this.penColor = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
      this.penWidth = 1.0;
      
      // Initialize WebGL
      this.initWebGL();
    }

    getInfo() {
      return {
        id: 'polyair',
        name: 'Polyair',
        color1: '#9966FF',
        color2: '#774DCB',
        color3: '#664DBF',
        blocks: [
          {
            opcode: 'enableGPURendering',
            blockType: Scratch.BlockType.COMMAND,
            text: 'enable GPU rendering for this sprite',
          },
          {
            opcode: 'disableGPURendering',
            blockType: Scratch.BlockType.COMMAND,
            text: 'disable GPU rendering for this sprite',
          },
          {
            opcode: 'isGPUEnabled',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'GPU rendering enabled?',
          },
          '---',
          {
            opcode: 'setResolution',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set render quality to [QUALITY]',
            arguments: {
              QUALITY: {
                type: Scratch.ArgumentType.STRING,
                menu: 'qualityMenu',
                defaultValue: '1080p'
              }
            }
          },
          {
            opcode: 'getResolutionWidth',
            blockType: Scratch.BlockType.REPORTER,
            text: 'resolution width',
          },
          {
            opcode: 'getResolutionHeight',
            blockType: Scratch.BlockType.REPORTER,
            text: 'resolution height',
          },
          '---',
          {
            opcode: 'setPenColor',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set GPU pen color to r:[R] g:[G] b:[B]',
            arguments: {
              R: { type: Scratch.ArgumentType.NUMBER, defaultValue: 255 },
              G: { type: Scratch.ArgumentType.NUMBER, defaultValue: 255 },
              B: { type: Scratch.ArgumentType.NUMBER, defaultValue: 255 }
            }
          },
          {
            opcode: 'setPenWidth',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set GPU pen width to [WIDTH]',
            arguments: {
              WIDTH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }
            }
          },
          {
            opcode: 'drawGPULine',
            blockType: Scratch.BlockType.COMMAND,
            text: 'GPU draw line from x:[X1] y:[Y1] to x:[X2] y:[Y2]',
            arguments: {
              X1: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              Y1: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              X2: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
              Y2: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 }
            }
          },
          {
            opcode: 'clearGPUCanvas',
            blockType: Scratch.BlockType.COMMAND,
            text: 'clear GPU canvas',
          },
        ],
        menus: {
          qualityMenu: {
            acceptReporters: true,
            items: ['480p', '720p', '1080p', '2K', '4K']
          }
        }
      };
    }

    initWebGL() {
      try {
        // Create offscreen canvas for GPU rendering
        this.glCanvas = document.createElement('canvas');
        this.glCanvas.width = this.resolution.width;
        this.glCanvas.height = this.resolution.height;
        
        // Get WebGL2 context
        this.gl = this.glCanvas.getContext('webgl2', {
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
          premultipliedAlpha: false
        });

        if (!this.gl) {
          console.warn('Polyair: WebGL2 not available, trying WebGL1');
          this.gl = this.glCanvas.getContext('webgl', {
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true,
            premultipliedAlpha: false
          });
        }

        if (!this.gl) {
          console.error('Polyair: WebGL not supported');
          return;
        }

        console.log('Polyair: WebGL initialized');

        // Initialize shaders
        this.initShaders();
        
        // Setup blending
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        // Clear to transparent
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        
      } catch (e) {
        console.error('Polyair: Failed to initialize WebGL:', e);
      }
    }

    initShaders() {
      const vertexShaderSource = `
        attribute vec2 a_position;
        attribute vec4 a_color;
        uniform vec2 u_resolution;
        varying vec4 v_color;
        
        void main() {
          vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
          clipSpace.y *= -1.0;
          gl_Position = vec4(clipSpace, 0.0, 1.0);
          v_color = a_color;
        }
      `;

      const fragmentShaderSource = `
        precision mediump float;
        varying vec4 v_color;
        
        void main() {
          gl_FragColor = v_color;
        }
      `;

      const vertexShader = this.compileShader(vertexShaderSource, this.gl.VERTEX_SHADER);
      const fragmentShader = this.compileShader(fragmentShaderSource, this.gl.FRAGMENT_SHADER);

      if (!vertexShader || !fragmentShader) {
        console.error('Polyair: Shader compilation failed');
        return;
      }

      this.shaderProgram = this.gl.createProgram();
      this.gl.attachShader(this.shaderProgram, vertexShader);
      this.gl.attachShader(this.shaderProgram, fragmentShader);
      this.gl.linkProgram(this.shaderProgram);

      if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
        console.error('Polyair: Program link failed:', this.gl.getProgramInfoLog(this.shaderProgram));
        return;
      }

      this.programInfo = {
        attribLocations: {
          position: this.gl.getAttribLocation(this.shaderProgram, 'a_position'),
          color: this.gl.getAttribLocation(this.shaderProgram, 'a_color'),
        },
        uniformLocations: {
          resolution: this.gl.getUniformLocation(this.shaderProgram, 'u_resolution'),
        }
      };

      console.log('Polyair: Shaders ready');
    }

    compileShader(source, type) {
      const shader = this.gl.createShader(type);
      this.gl.shaderSource(shader, source);
      this.gl.compileShader(shader);

      if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
        console.error('Polyair: Shader error:', this.gl.getShaderInfoLog(shader));
        this.gl.deleteShader(shader);
        return null;
      }

      return shader;
    }

    // Block implementations
    enableGPURendering(args, util) {
      const targetId = util.target.id;
      this.gpuSprites.add(targetId);
    }

    disableGPURendering(args, util) {
      const targetId = util.target.id;
      this.gpuSprites.delete(targetId);
    }

    isGPUEnabled(args, util) {
      return this.gpuSprites.has(util.target.id);
    }

    setResolution(args) {
      const quality = args.QUALITY;
      
      const resolutions = {
        '480p': { width: 854, height: 480 },
        '720p': { width: 1280, height: 720 },
        '1080p': { width: 1920, height: 1080 },
        '2K': { width: 2560, height: 1440 },
        '4K': { width: 3840, height: 2160 }
      };

      this.resolution = resolutions[quality] || resolutions['1080p'];
      this.targetResolution = quality;
      
      if (this.glCanvas) {
        this.glCanvas.width = this.resolution.width;
        this.glCanvas.height = this.resolution.height;
      }
      
      if (this.gl) {
        this.gl.viewport(0, 0, this.resolution.width, this.resolution.height);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }
    }

    getResolutionWidth() {
      return this.resolution.width;
    }

    getResolutionHeight() {
      return this.resolution.height;
    }

    setPenColor(args) {
      const r = Math.max(0, Math.min(255, Scratch.Cast.toNumber(args.R))) / 255;
      const g = Math.max(0, Math.min(255, Scratch.Cast.toNumber(args.G))) / 255;
      const b = Math.max(0, Math.min(255, Scratch.Cast.toNumber(args.B))) / 255;
      this.penColor = { r, g, b, a: 1.0 };
    }

    setPenWidth(args) {
      this.penWidth = Math.max(1, Scratch.Cast.toNumber(args.WIDTH));
    }

    drawGPULine(args) {
      if (!this.gl || !this.shaderProgram) return;

      const x1 = Scratch.Cast.toNumber(args.X1);
      const y1 = Scratch.Cast.toNumber(args.Y1);
      const x2 = Scratch.Cast.toNumber(args.X2);
      const y2 = Scratch.Cast.toNumber(args.Y2);

      this.gl.useProgram(this.shaderProgram);
      this.gl.uniform2f(this.programInfo.uniformLocations.resolution, 
        this.resolution.width, this.resolution.height);

      const centerX = this.resolution.width / 2;
      const centerY = this.resolution.height / 2;
      
      const vertices = new Float32Array([
        centerX + x1, centerY - y1,
        centerX + x2, centerY - y2
      ]);

      const colors = new Float32Array([
        this.penColor.r, this.penColor.g, this.penColor.b, this.penColor.a,
        this.penColor.r, this.penColor.g, this.penColor.b, this.penColor.a
      ]);

      const positionBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
      this.gl.enableVertexAttribArray(this.programInfo.attribLocations.position);
      this.gl.vertexAttribPointer(this.programInfo.attribLocations.position, 2, this.gl.FLOAT, false, 0, 0);

      const colorBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, colorBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, colors, this.gl.STATIC_DRAW);
      this.gl.enableVertexAttribArray(this.programInfo.attribLocations.color);
      this.gl.vertexAttribPointer(this.programInfo.attribLocations.color, 4, this.gl.FLOAT, false, 0, 0);

      this.gl.lineWidth(this.penWidth);
      this.gl.drawArrays(this.gl.LINES, 0, 2);

      this.gl.deleteBuffer(positionBuffer);
      this.gl.deleteBuffer(colorBuffer);
    }

    clearGPUCanvas() {
      if (!this.gl) return;
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }

  Scratch.extensions.register(new PolyairExtension());
})(Scratch);
