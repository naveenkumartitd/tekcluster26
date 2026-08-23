import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const EVENT_DATE = new Date('2026-09-19T09:00:00+05:30').getTime();

function SplashCursor({
  SIM_RESOLUTION = 128,
  DYE_RESOLUTION = 1440,
  CAPTURE_RESOLUTION = 512,
  DENSITY_DISSIPATION = 3.5,
  VELOCITY_DISSIPATION = 2,
  PRESSURE = 0.1,
  PRESSURE_ITERATIONS = 20,
  CURL = 3,
  SPLAT_RADIUS = 0.2,
  SPLAT_FORCE = 6000,
  SHADING = true,
  COLOR_UPDATE_SPEED = 10,
  BACK_COLOR = { r: 0.04, g: 0.05, b: 0.12 },
  TRANSPARENT = true,
  RAINBOW_MODE = true,
  COLOR = '#7a7cff',
}) {
  const canvasRef = useRef(null);
  const animationFrameId = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isActive = true;

    function pointerPrototype() {
      this.id = -1;
      this.texcoordX = 0;
      this.texcoordY = 0;
      this.prevTexcoordX = 0;
      this.prevTexcoordY = 0;
      this.deltaX = 0;
      this.deltaY = 0;
      this.down = false;
      this.moved = false;
      this.color = [0, 0, 0];
    }

    const config = {
      SIM_RESOLUTION,
      DYE_RESOLUTION,
      CAPTURE_RESOLUTION,
      DENSITY_DISSIPATION,
      VELOCITY_DISSIPATION,
      PRESSURE,
      PRESSURE_ITERATIONS,
      CURL,
      SPLAT_RADIUS,
      SPLAT_FORCE,
      SHADING,
      COLOR_UPDATE_SPEED,
      PAUSED: false,
      BACK_COLOR,
      TRANSPARENT,
      RAINBOW_MODE,
      COLOR,
    };

    const pointers = [new pointerPrototype()];

    const { gl, ext } = getWebGLContext(canvas);
    if (!ext.supportLinearFiltering) {
      config.DYE_RESOLUTION = 256;
      config.SHADING = false;
    }

    function getWebGLContext(canvasElement) {
      const params = {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
      };

      let glContext = canvasElement.getContext('webgl2', params);
      const isWebGL2 = !!glContext;
      if (!isWebGL2) {
        glContext = canvasElement.getContext('webgl', params) || canvasElement.getContext('experimental-webgl', params);
      }

      let halfFloat;
      let supportLinearFiltering;
      if (isWebGL2) {
        glContext.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = glContext.getExtension('OES_texture_float_linear');
      } else {
        halfFloat = glContext.getExtension('OES_texture_half_float');
        supportLinearFiltering = glContext.getExtension('OES_texture_half_float_linear');
      }
      glContext.clearColor(0.0, 0.0, 0.0, 1.0);

      const halfFloatTexType = isWebGL2 ? glContext.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES;
      let formatRGBA;
      let formatRG;
      let formatR;

      if (isWebGL2) {
        formatRGBA = getSupportedFormat(glContext, glContext.RGBA16F, glContext.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(glContext, glContext.RG16F, glContext.RG, halfFloatTexType);
        formatR = getSupportedFormat(glContext, glContext.R16F, glContext.RED, halfFloatTexType);
      } else {
        formatRGBA = getSupportedFormat(glContext, glContext.RGBA, glContext.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(glContext, glContext.RGBA, glContext.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(glContext, glContext.RGBA, glContext.RGBA, halfFloatTexType);
      }

      return {
        gl: glContext,
        ext: {
          formatRGBA,
          formatRG,
          formatR,
          halfFloatTexType,
          supportLinearFiltering,
        },
      };
    }

    function getSupportedFormat(glContext, internalFormat, format, type) {
      if (!supportRenderTextureFormat(glContext, internalFormat, format, type)) {
        switch (internalFormat) {
          case glContext.R16F:
            return getSupportedFormat(glContext, glContext.RG16F, glContext.RG, type);
          case glContext.RG16F:
            return getSupportedFormat(glContext, glContext.RGBA16F, glContext.RGBA, type);
          default:
            return null;
        }
      }
      return { internalFormat, format };
    }

    function supportRenderTextureFormat(glContext, internalFormat, format, type) {
      const texture = glContext.createTexture();
      glContext.bindTexture(glContext.TEXTURE_2D, texture);
      glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.NEAREST);
      glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MAG_FILTER, glContext.NEAREST);
      glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_S, glContext.CLAMP_TO_EDGE);
      glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_T, glContext.CLAMP_TO_EDGE);
      glContext.texImage2D(glContext.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      const fbo = glContext.createFramebuffer();
      glContext.bindFramebuffer(glContext.FRAMEBUFFER, fbo);
      glContext.framebufferTexture2D(glContext.FRAMEBUFFER, glContext.COLOR_ATTACHMENT0, glContext.TEXTURE_2D, texture, 0);
      const status = glContext.checkFramebufferStatus(glContext.FRAMEBUFFER);
      return status === glContext.FRAMEBUFFER_COMPLETE;
    }

    class Material {
      constructor(vertexShader, fragmentShaderSource) {
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = [];
        this.activeProgram = null;
        this.uniforms = [];
      }

      setKeywords(keywords) {
        let hash = 0;
        for (let i = 0; i < keywords.length; i++) hash += hashCode(keywords[i]);
        let program = this.programs[hash];
        if (program == null) {
          const fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
          program = createProgram(this.vertexShader, fragmentShader);
          this.programs[hash] = program;
        }
        if (program === this.activeProgram) return;
        this.uniforms = getUniforms(program);
        this.activeProgram = program;
      }

      bind() {
        gl.useProgram(this.activeProgram);
      }
    }

    class Program {
      constructor(vertexShader, fragmentShader) {
        this.uniforms = {};
        this.program = createProgram(vertexShader, fragmentShader);
        this.uniforms = getUniforms(this.program);
      }

      bind() {
        gl.useProgram(this.program);
      }
    }

    function createProgram(vertexShader, fragmentShader) {
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.trace(gl.getProgramInfoLog(program));
      return program;
    }

    function getUniforms(program) {
      const uniforms = {};
      const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < uniformCount; i++) {
        const uniformName = gl.getActiveUniform(program, i).name;
        uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
      }
      return uniforms;
    }

    function compileShader(type, source, keywords) {
      source = addKeywords(source, keywords);
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.trace(gl.getShaderInfoLog(shader));
      return shader;
    }

    function addKeywords(source, keywords) {
      if (!keywords) return source;
      let keywordsString = '';
      keywords.forEach((keyword) => {
        keywordsString += '#define ' + keyword + '\n';
      });
      return keywordsString + source;
    }

    const baseVertexShader = compileShader(
      gl.VERTEX_SHADER,
      `
        precision highp float;
        attribute vec2 aPosition;
        varying vec2 vUv;
        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform vec2 texelSize;

        void main () {
          vUv = aPosition * 0.5 + 0.5;
          vL = vUv - vec2(texelSize.x, 0.0);
          vR = vUv + vec2(texelSize.x, 0.0);
          vT = vUv + vec2(0.0, texelSize.y);
          vB = vUv - vec2(0.0, texelSize.y);
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `,
    );

    const copyShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        uniform sampler2D uTexture;

        void main () {
          gl_FragColor = texture2D(uTexture, vUv);
        }
      `,
    );

    const clearShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        uniform sampler2D uTexture;
        uniform float value;

        void main () {
          gl_FragColor = value * texture2D(uTexture, vUv);
        }
      `,
    );

    const displayShaderSource = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      uniform vec2 texelSize;

      vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
      }

      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        #ifdef SHADING
          vec3 lc = texture2D(uTexture, vL).rgb;
          vec3 rc = texture2D(uTexture, vR).rgb;
          vec3 tc = texture2D(uTexture, vT).rgb;
          vec3 bc = texture2D(uTexture, vB).rgb;

          float dx = length(rc) - length(lc);
          float dy = length(tc) - length(bc);

          vec3 n = normalize(vec3(dx, dy, length(texelSize)));
          vec3 l = vec3(0.0, 0.0, 1.0);

          float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
          c *= diffuse;
        #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
      }
    `;

    const splatShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        uniform sampler2D uTarget;
        uniform float aspectRatio;
        uniform vec3 color;
        uniform vec2 point;
        uniform float radius;

        void main () {
          vec2 p = vUv - point.xy;
          p.x *= aspectRatio;
          vec3 splat = exp(-dot(p, p) / radius) * color;
          vec3 base = texture2D(uTarget, vUv).xyz;
          gl_FragColor = vec4(base + splat, 1.0);
        }
      `,
    );

    const advectionShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform vec2 texelSize;
        uniform vec2 dyeTexelSize;
        uniform float dt;
        uniform float dissipation;

        vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
          vec2 st = uv / tsize - 0.5;
          vec2 iuv = floor(st);
          vec2 fuv = fract(st);

          vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
          vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
          vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
          vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

          return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
        }

        void main () {
          #ifdef MANUAL_FILTERING
            vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
            vec4 result = bilerp(uSource, coord, dyeTexelSize);
          #else
            vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
            vec4 result = texture2D(uSource, coord);
          #endif
          float decay = 1.0 + dissipation * dt;
          gl_FragColor = result / decay;
        }
      `,
      ext.supportLinearFiltering ? null : ['MANUAL_FILTERING'],
    );

    const divergenceShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uVelocity;

        void main () {
          float L = texture2D(uVelocity, vL).x;
          float R = texture2D(uVelocity, vR).x;
          float T = texture2D(uVelocity, vT).y;
          float B = texture2D(uVelocity, vB).y;

          vec2 C = texture2D(uVelocity, vUv).xy;
          if (vL.x < 0.0) L = -C.x;
          if (vR.x > 1.0) R = -C.x;
          if (vT.y > 1.0) T = -C.y;
          if (vB.y < 0.0) B = -C.y;

          float div = 0.5 * (R - L + T - B);
          gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }
      `,
    );

    const curlShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uVelocity;

        void main () {
          float L = texture2D(uVelocity, vL).y;
          float R = texture2D(uVelocity, vR).y;
          float T = texture2D(uVelocity, vT).x;
          float B = texture2D(uVelocity, vB).x;
          float vorticity = R - L - T + B;
          gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
        }
      `,
    );

    const vorticityShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform sampler2D uVelocity;
        uniform sampler2D uCurl;
        uniform float curl;
        uniform float dt;

        void main () {
          float L = texture2D(uCurl, vL).x;
          float R = texture2D(uCurl, vR).x;
          float T = texture2D(uCurl, vT).x;
          float B = texture2D(uCurl, vB).x;
          float C = texture2D(uCurl, vUv).x;

          vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
          force /= length(force) + 0.0001;
          force *= curl * C;
          force.y *= -1.0;

          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity += force * dt;
          velocity = min(max(velocity, -1000.0), 1000.0);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
      `,
    );

    const pressureShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uPressure;
        uniform sampler2D uDivergence;

        void main () {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          float C = texture2D(uPressure, vUv).x;
          float divergence = texture2D(uDivergence, vUv).x;
          float pressure = (L + R + B + T - divergence) * 0.25;
          gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
        }
      `,
    );

    const gradientSubtractShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uPressure;
        uniform sampler2D uVelocity;

        void main () {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity.xy -= vec2(R - L, T - B);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
      `,
    );

    const blit = (() => {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      return (target, clear = false) => {
        if (target == null) {
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
          gl.viewport(0, 0, target.width, target.height);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }

        if (clear) {
          gl.clearColor(0.0, 0.0, 0.0, 1.0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      };
    })();

    let dye;
    let velocity;
    let divergence;
    let curlBuffer;
    let pressure;

    const copyProgram = new Program(baseVertexShader, copyShader);
    const clearProgram = new Program(baseVertexShader, clearShader);
    const splatProgram = new Program(baseVertexShader, splatShader);
    const advectionProgram = new Program(baseVertexShader, advectionShader);
    const divergenceProgram = new Program(baseVertexShader, divergenceShader);
    const curlProgram = new Program(baseVertexShader, curlShader);
    const vorticityProgram = new Program(baseVertexShader, vorticityShader);
    const pressureProgram = new Program(baseVertexShader, pressureShader);
    const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);
    const displayMaterial = new Material(baseVertexShader, displayShaderSource);

    function initFramebuffers() {
      const simRes = getResolution(config.SIM_RESOLUTION);
      const dyeRes = getResolution(config.DYE_RESOLUTION);
      const texType = ext.halfFloatTexType;
      const rgba = ext.formatRGBA;
      const rg = ext.formatRG;
      const r = ext.formatR;
      const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
      gl.disable(gl.BLEND);

      if (!dye) {
        dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
      } else {
        dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
      }

      if (!velocity) {
        velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
      } else {
        velocity = resizeDoubleFBO(
          velocity,
          simRes.width,
          simRes.height,
          rg.internalFormat,
          rg.format,
          texType,
          filtering,
        );
      }

      divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
      curlBuffer = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
      pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    }

    function createFBO(w, h, internalFormat, format, type, param) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);

      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX: 1.0 / w,
        texelSizeY: 1.0 / h,
        attach(id) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          return id;
        },
      };
    }

    function createDoubleFBO(w, h, internalFormat, format, type, param) {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param);
      let fbo2 = createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read() {
          return fbo1;
        },
        set read(value) {
          fbo1 = value;
        },
        get write() {
          return fbo2;
        },
        set write(value) {
          fbo2 = value;
        },
        swap() {
          const temp = fbo1;
          fbo1 = fbo2;
          fbo2 = temp;
        },
      };
    }

    function resizeFBO(target, w, h, internalFormat, format, type, param) {
      const newFBO = createFBO(w, h, internalFormat, format, type, param);
      copyProgram.bind();
      gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
      blit(newFBO);
      return newFBO;
    }

    function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
      if (target.width === w && target.height === h) return target;
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
      target.write = createFBO(w, h, internalFormat, format, type, param);
      target.width = w;
      target.height = h;
      target.texelSizeX = 1.0 / w;
      target.texelSizeY = 1.0 / h;
      return target;
    }

    function updateKeywords() {
      const displayKeywords = [];
      if (config.SHADING) displayKeywords.push('SHADING');
      displayMaterial.setKeywords(displayKeywords);
    }

    updateKeywords();
    initFramebuffers();

    let lastUpdateTime = Date.now();
    let colorUpdateTimer = 0.0;

    function updateFrame() {
      if (!isActive) return;
      const dt = calcDeltaTime();
      if (resizeCanvas()) initFramebuffers();
      updateColors(dt);
      applyInputs();
      step(dt);
      render(null);
      animationFrameId.current = requestAnimationFrame(updateFrame);
    }

    function calcDeltaTime() {
      const now = Date.now();
      let dt = (now - lastUpdateTime) / 1000;
      dt = Math.min(dt, 0.016666);
      lastUpdateTime = now;
      return dt;
    }

    function resizeCanvas() {
      const width = scaleByPixelRatio(canvas.clientWidth);
      const height = scaleByPixelRatio(canvas.clientHeight);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        return true;
      }
      return false;
    }

    function updateColors(dt) {
      colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
      if (colorUpdateTimer >= 1) {
        colorUpdateTimer = wrap(colorUpdateTimer, 0, 1);
        pointers.forEach((pointer) => {
          pointer.color = generateColor();
        });
      }
    }

    function applyInputs() {
      pointers.forEach((pointer) => {
        if (pointer.moved) {
          pointer.moved = false;
          splatPointer(pointer);
        }
      });
    }

    function step(dt) {
      gl.disable(gl.BLEND);

      curlProgram.bind();
      gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(curlBuffer);

      vorticityProgram.bind();
      gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(vorticityProgram.uniforms.uCurl, curlBuffer.attach(1));
      gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
      gl.uniform1f(vorticityProgram.uniforms.dt, dt);
      blit(velocity.write);
      velocity.swap();

      divergenceProgram.bind();
      gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(divergence);

      clearProgram.bind();
      gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
      gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
      blit(pressure.write);
      pressure.swap();

      pressureProgram.bind();
      gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
      for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write);
        pressure.swap();
      }

      gradienSubtractProgram.bind();
      gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
      gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
      blit(velocity.write);
      velocity.swap();

      advectionProgram.bind();
      gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      if (!ext.supportLinearFiltering) {
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      const velocityId = velocity.read.attach(0);
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
      gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
      gl.uniform1f(advectionProgram.uniforms.dt, dt);
      gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
      blit(velocity.write);
      velocity.swap();

      if (!ext.supportLinearFiltering) {
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
      }
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
      gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
      blit(dye.write);
      dye.swap();
    }

    function render(target) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      drawDisplay(target);
    }

    function drawDisplay(target) {
      const width = target == null ? gl.drawingBufferWidth : target.width;
      const height = target == null ? gl.drawingBufferHeight : target.height;
      displayMaterial.bind();
      if (config.SHADING) gl.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
      gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
      blit(target);
    }

    function splatPointer(pointer) {
      const dx = pointer.deltaX * config.SPLAT_FORCE;
      const dy = pointer.deltaY * config.SPLAT_FORCE;
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
    }

    function clickSplat(pointer) {
      const color = generateColor();
      color.r *= 10.0;
      color.g *= 10.0;
      color.b *= 10.0;
      const dx = 10 * (Math.random() - 0.5);
      const dy = 30 * (Math.random() - 0.5);
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
    }

    function splat(x, y, dx, dy, color) {
      splatProgram.bind();
      gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
      gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
      gl.uniform2f(splatProgram.uniforms.point, x, y);
      gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
      gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
      blit(velocity.write);
      velocity.swap();

      gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
      gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
      blit(dye.write);
      dye.swap();
    }

    function correctRadius(radius) {
      const aspectRatio = canvas.width / canvas.height;
      if (aspectRatio > 1) return radius * aspectRatio;
      return radius;
    }

    function updatePointerDownData(pointer, id, posX, posY) {
      pointer.id = id;
      pointer.down = true;
      pointer.moved = false;
      pointer.texcoordX = posX / canvas.width;
      pointer.texcoordY = 1.0 - posY / canvas.height;
      pointer.prevTexcoordX = pointer.texcoordX;
      pointer.prevTexcoordY = pointer.texcoordY;
      pointer.deltaX = 0;
      pointer.deltaY = 0;
      pointer.color = generateColor();
    }

    function updatePointerMoveData(pointer, posX, posY, color) {
      pointer.prevTexcoordX = pointer.texcoordX;
      pointer.prevTexcoordY = pointer.texcoordY;
      pointer.texcoordX = posX / canvas.width;
      pointer.texcoordY = 1.0 - posY / canvas.height;
      pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
      pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
      pointer.color = color;
    }

    function updatePointerUpData(pointer) {
      pointer.down = false;
    }

    function correctDeltaX(delta) {
      const aspectRatio = canvas.width / canvas.height;
      if (aspectRatio < 1) return delta * aspectRatio;
      return delta;
    }

    function correctDeltaY(delta) {
      const aspectRatio = canvas.width / canvas.height;
      if (aspectRatio > 1) return delta / aspectRatio;
      return delta;
    }

    function hexToRGB(hex) {
      let value = hex.replace('#', '');
      if (value.length === 3) value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
      const r = parseInt(value.slice(0, 2), 16) / 255;
      const g = parseInt(value.slice(2, 4), 16) / 255;
      const b = parseInt(value.slice(4, 6), 16) / 255;
      return { r: r * 0.15, g: g * 0.15, b: b * 0.15 };
    }

    function generateColor() {
      if (!config.RAINBOW_MODE) return hexToRGB(config.COLOR);
      const c = HSVtoRGB(Math.random(), 1.0, 1.0);
      return {
        r: c.r * 0.15,
        g: c.g * 0.15,
        b: c.b * 0.15,
      };
    }

    function HSVtoRGB(h, s, v) {
      let r;
      let g;
      let b;
      const i = Math.floor(h * 6);
      const f = h * 6 - i;
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);

      switch (i % 6) {
        case 0:
          r = v; g = t; b = p; break;
        case 1:
          r = q; g = v; b = p; break;
        case 2:
          r = p; g = v; b = t; break;
        case 3:
          r = p; g = q; b = v; break;
        case 4:
          r = t; g = p; b = v; break;
        case 5:
          r = v; g = p; b = q; break;
        default:
          break;
      }

      return { r, g, b };
    }

    function wrap(value, min, max) {
      const range = max - min;
      if (range === 0) return min;
      return ((value - min) % range) + min;
    }

    function getResolution(resolution) {
      let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
      if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
      const min = Math.round(resolution);
      const max = Math.round(resolution * aspectRatio);
      if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
      return { width: min, height: max };
    }

    function scaleByPixelRatio(input) {
      const pixelRatio = window.devicePixelRatio || 1;
      return Math.floor(input * pixelRatio);
    }

    function hashCode(s) {
      if (s.length === 0) return 0;
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0;
      }
      return hash;
    }

    function handleMouseDown(event) {
      const pointer = pointers[0];
      const posX = scaleByPixelRatio(event.clientX);
      const posY = scaleByPixelRatio(event.clientY);
      updatePointerDownData(pointer, -1, posX, posY);
      clickSplat(pointer);
    }

    function handleMouseMove(event) {
      const pointer = pointers[0];
      const posX = scaleByPixelRatio(event.clientX);
      const posY = scaleByPixelRatio(event.clientY);
      updatePointerMoveData(pointer, posX, posY, pointer.color);
    }

    function handleTouchStart(event) {
      const touches = event.targetTouches;
      const pointer = pointers[0];
      for (let i = 0; i < touches.length; i++) {
        const posX = scaleByPixelRatio(touches[i].clientX);
        const posY = scaleByPixelRatio(touches[i].clientY);
        updatePointerDownData(pointer, touches[i].identifier, posX, posY);
      }
    }

    function handleTouchMove(event) {
      const touches = event.targetTouches;
      const pointer = pointers[0];
      for (let i = 0; i < touches.length; i++) {
        const posX = scaleByPixelRatio(touches[i].clientX);
        const posY = scaleByPixelRatio(touches[i].clientY);
        updatePointerMoveData(pointer, posX, posY, pointer.color);
      }
    }

    function handleTouchEnd(event) {
      const touches = event.changedTouches;
      const pointer = pointers[0];
      for (let i = 0; i < touches.length; i++) {
        updatePointerUpData(pointer);
      }
    }

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchmove', handleTouchMove, false);
    window.addEventListener('touchend', handleTouchEnd);

    updateFrame();

    return () => {
      isActive = false;
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 25,
        pointerEvents: 'none',
        width: '100%',
        height: '100%',
      }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        id="fluid"
        style={{
          width: '100vw',
          height: '100vh',
          display: 'block',
          opacity: 0.9,
          background: 'transparent',
        }}
      />
    </div>
  );
}

function App() {
  const [timeLeft, setTimeLeft] = useState(getCountdown());
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(getCountdown()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(
    () => [
      ['14', 'National Level'],
      ['08', 'Paper Tracks'],
      ['02', 'Flagship Events'],
      ['₹150', 'Per Head'],
    ],
    [],
  );

  const paperTopics = [
    { id: '01', title: 'GENERATIVE AI', subtitle: '& AGENTIC AI', x: '16%', y: '20%', angle: '-12deg', delay: '0s' },
    { id: '02', title: 'PROMPT', subtitle: 'ENGINEERING', x: '83%', y: '18%', angle: '12deg', delay: '0.18s' },
    { id: '03', title: 'QUANTUM', subtitle: 'COMPUTING & AI', x: '22%', y: '42%', angle: '-8deg', delay: '0.32s' },
    { id: '04', title: 'LARGE LANGUAGE', subtitle: 'MODELS & NLP', x: '78%', y: '42%', angle: '8deg', delay: '0.4s' },
    { id: '05', title: 'RETRIEVAL', subtitle: 'AUGMENTED GENERATION', x: '16%', y: '64%', angle: '-10deg', delay: '0.48s' },
    { id: '06', title: 'IMAGE', subtitle: 'ANALYSIS', x: '84%', y: '64%', angle: '10deg', delay: '0.56s' },
    { id: '07', title: 'FACIAL', subtitle: 'RECOGNITION', x: '34%', y: '82%', angle: '-5deg', delay: '0.64s' },
    { id: '08', title: 'TIME-SERIES', subtitle: 'FORECASTING', x: '66%', y: '82%', angle: '6deg', delay: '0.72s' },
  ];

  const [pointerOffset, setPointerOffset] = useState({ x: 0, y: 0 });

  const handlePointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width - 0.5) * 20;
    const localY = ((event.clientY - rect.top) / rect.height - 0.5) * 20;
    setPointerOffset({ x: localX, y: localY });
  };

  const resetPointer = () => setPointerOffset({ x: 0, y: 0 });

  const highlights = [
    {
      label: 'AI Challenges',
      title: 'Build tomorrow with hands-on innovation',
      text: 'Test your ideas under real pressure with problem-based AI and data challenges designed for bold thinkers.',
    },
    {
      label: 'Expert Talks',
      title: 'Learn from the minds shaping the future',
      text: 'Hear from specialists, researchers, and technologists who bring AI, systems, and product thinking to life.',
    },
    {
      label: 'Research Exposure',
      title: 'Showcase ideas that move industries',
      text: 'Present current research, prototypes, and ideas that could define the next wave of technology.',
    },
  ];

  const schedule = [
    { date: '12 Sep', title: 'Paper Submission Deadline' },
    { date: '14 Sep', title: 'Acceptance Intimation' },
    { date: '19 Sep', title: 'Symposium Day & Awards' },
  ];

  const faqs = [
    {
      q: 'Who can attend?',
      a: 'Students, innovators, and tech enthusiasts from engineering and related disciplines are welcome to participate.',
    },
    {
      q: 'Is the event only for paper presentations?',
      a: 'No. The symposium includes technical paper presentations, interactive events, and competitive showcases across AI and emerging technologies.',
    },
    {
      q: 'How many members can a team have?',
      a: 'A team can include up to 3 participants for the registration and event participation process.',
    },
  ];

  return (
    <div className="site-shell">
      <SplashCursor />
      <div className="stars" aria-hidden="true" />
      <div className="grid-glow" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <div className="ambient-lights" aria-hidden="true">
        <span className="beam beam-left" />
        <span className="beam beam-right" />
        <span className="beam beam-mid" />
        <span className="circuit circuit-left" />
        <span className="circuit circuit-right" />
        <span className="hud hud-one" />
        <span className="hud hud-two" />
        <span className="hud hud-three" />
      </div>

      <Header menuOpen={menuOpen} setMenuOpen={setMenuOpen} />

      <main>
        <section className="hero" id="home">
          <div className="hero-content">
            <div className="eyebrow">
              <span className="pulse-dot" /> 14TH NATIONAL LEVEL TECHNICAL SYMPOSIUM
            </div>

            <p className="institution">KONGUNADU COLLEGE OF ENGINEERING AND TECHNOLOGY</p>
            <p className="department">DEPARTMENT OF ARTIFICIAL INTELLIGENCE &amp; DATA SCIENCE</p>

            <div className="hero-visual" aria-hidden="true">
              <div className="eagle-glow" />
              <img src="/eagle.png" alt="" className="hero-eagle-image" />
            </div>

            <div className="brand-mark">
              <span className="brand-small">TEK</span>
              <span className="brand-large">
                CLUSTER<span className="brand-year">'26</span>
              </span>
            </div>

            <div className="tagline">
              <span>CODE.</span>
              <span>CREATE.</span>
              <span>CONQUER.</span>
            </div>

            <div className="date-pill">
              <span className="day">19</span>
              <span>
                <b>SEPTEMBER</b>
                <small>2026</small>
              </span>
            </div>

            <div className="hero-actions">
              <a
                className="btn btn-primary"
                href="https://forms.gle/pMZJ2vybyVSeRSD78"
                target="_blank"
                rel="noreferrer"
              >
                REGISTER NOW <span>↗</span>
              </a>
              <a className="btn btn-ghost" href="#events">
                EXPLORE EVENTS
              </a>
            </div>
          </div>
        </section>

        <section className="stats-wrap section-pad" aria-label="Symposium highlights">
          <div className="stats-grid">
            {stats.map(([value, label]) => (
              <div className="stat-card" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="section-pad section" id="about">
          <div className="section-header">
            <div className="section-kicker">/ ABOUT THE MISSION</div>
            <h2>
              ENTER THE <span>FLIGHT ZONE.</span>
            </h2>
          </div>

          <div className="about-grid">
            <div className="about-copy">
              <p>
                TEKCLUSTER'26 is a national-level technical symposium created to move bright minds from
                ideas to impact. It is where innovation, product thinking, and emerging AI meet through
                research, competition, and collaboration.
              </p>
              <p>
                Inspired by the eagle — precision, vision, and fearless execution — the event celebrates
                creative thinking and skill-building across engineering, data science, and digital
                transformation.
              </p>
            </div>

            <div className="mission-cards">
              {highlights.map((item) => (
                <article className="mission-card" key={item.label}>
                  <span>{item.label}</span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section-pad section paper-field" id="topics">
          <div className="section-header split-header">
            <div>
              <div className="section-kicker">/ PAPER PRESENTATION</div>
              <h2>
                IDEAS <span>TAKE FLIGHT.</span>
              </h2>
            </div>
            <p>Choose a frontier. Build a perspective. Present a future.</p>
          </div>

          <div className="paper-field-shell">
            <div
              className="paper-field-stage"
              onMouseMove={handlePointerMove}
              onMouseLeave={resetPointer}
              style={{
                '--pointer-x': `${pointerOffset.x}px`,
                '--pointer-y': `${pointerOffset.y}px`,
              }}
            >
              <div className="research-core" aria-label="AI Research Wings">
                <div className="core-ring core-ring-one" />
                <div className="core-ring core-ring-two" />
                <div className="core-ring core-ring-three" />
                <div className="research-emblem">
                  <img src="/eagle.png" alt="Eagle research emblem" />
                </div>
                <div className="research-core-label">
                  <span>AI</span>
                  <span>RESEARCH</span>
                  <span>WINGS</span>
                </div>
              </div>

              {paperTopics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  className="floating-topic-card"
                  style={{
                    '--x': topic.x,
                    '--y': topic.y,
                    '--angle': topic.angle,
                    '--delay': topic.delay,
                  }}
                >
                  <span className="topic-index">{topic.id}</span>
                  <span className="topic-title">{topic.title}</span>
                  <span className="topic-subtitle">{topic.subtitle}</span>
                  <span className="topic-arrow">↗</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="section-pad section" id="events">
          <div className="section-kicker">/ EVENTS</div>
          <div className="events-grid">
            <article className="event-card featured">
              <div className="event-top">
                <span>01</span>
                <span>FLAGSHIP</span>
              </div>
              <div className="event-icon">✦</div>
              <h3>PROMPT2PIXEL</h3>
              <p>
                Turn language into visuals. Think fast, prompt smart, and craft something that leaves an
                impression.
              </p>
              <a href="https://forms.gle/pMZJ2vybyVSeRSD78" target="_blank" rel="noreferrer">
                JOIN EVENT <span>↗</span>
              </a>
            </article>

            <article className="event-card">
              <div className="event-top">
                <span>02</span>
                <span>SHOWDOWN</span>
              </div>
              <div className="event-icon">⚡</div>
              <h3>BANTER BATTLE</h3>
              <p>
                Think on your feet, speak with confidence, and own the room in a quick-fire battle of wit
                and presence.
              </p>
              <a href="https://forms.gle/pMZJ2vybyVSeRSD78" target="_blank" rel="noreferrer">
                JOIN EVENT <span>↗</span>
              </a>
            </article>
          </div>
        </section>

        <section className="section-pad countdown-section section">
          <div className="section-kicker">/ LAUNCH SEQUENCE</div>
          <h2>
            THE EAGLE <span>TAKES OFF IN.</span>
          </h2>
          <div className="countdown-grid" aria-live="polite">
            <CountdownBox value={timeLeft.days} label="DAYS" />
            <CountdownBox value={timeLeft.hours} label="HOURS" />
            <CountdownBox value={timeLeft.minutes} label="MINUTES" />
            <CountdownBox value={timeLeft.seconds} label="SECONDS" />
          </div>
        </section>

        <section className="section-pad schedule section" id="dates">
          <div className="section-kicker">/ IMPORTANT DATES</div>
          <div className="dates-grid">
            {schedule.map((item) => (
              <DateCard key={item.date} date={item.date} title={item.title} highlight={item.date === '19 Sep'} />
            ))}
          </div>
        </section>

        <section className="section-pad faq section">
          <div className="section-kicker">/ FAQ</div>
          <div className="faq-grid">
            {faqs.map((item) => (
              <div className="faq-item" key={item.q}>
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section-pad section" id="register">
          <div className="register-card">
            <div className="register-content">
              <div className="section-kicker">/ REGISTRATION</div>
              <h2 className="register-headline">
                <span className="register-ready">READY TO</span>
                <span className="register-flight">TAKE FLIGHT?</span>
              </h2>
              <div className="register-meta">
                <p>₹150 per head</p>
                <p>MAXIMUM 3 PARTICIPANTS PER TEAM</p>
              </div>
              <a
                className="btn btn-primary"
                href="https://forms.gle/pMZJ2vybyVSeRSD78"
                target="_blank"
                rel="noreferrer"
              >
                REGISTER NOW <span>→</span>
              </a>
            </div>

            <div className="qr-placeholder" role="img" aria-label="Registration QR code">
              <img src="/qr.jpeg" alt="Registration QR code" className="qr-image" />
              <span>SCAN TO REGISTER</span>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function Header({ menuOpen, setMenuOpen }) {
  const nav = [
    ['Home', '#home'],
    ['About', '#about'],
    ['Topics', '#topics'],
    ['Events', '#events'],
    ['Dates', '#dates'],
    ['Register', 'https://forms.gle/pMZJ2vybyVSeRSD78'],
  ];

  return (
    <header className="site-header">
      <a
        className="college-logo"
        href="https://kongunadu.ac.in"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Kongunadu College official website"
      >
        <img
          src="/college-logo.png"
          alt="Kongunadu College of Engineering and Technology"
          className="college-logo-image"
        />

        <div className="college-logo-text">
          <strong>KONGUNADU</strong>
          <span>COLLEGE OF ENGINEERING</span>
          <span>AND TECHNOLOGY</span>
        </div>
      </a>

      <button
        className="menu-toggle"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Toggle navigation"
        aria-expanded={menuOpen}
        aria-controls="site-nav"
      >
        ☰
      </button>

      <nav id="site-nav" className={menuOpen ? 'open' : ''}>
        {nav.map(([label, href]) => (
          <a href={href} key={label} onClick={() => setMenuOpen(false)}>
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function CountdownBox({ value, label }) {
  return (
    <div className="countdown-box">
      <strong>{String(value).padStart(2, '0')}</strong>
      <span>{label}</span>
    </div>
  );
}

function DateCard({ date, title, highlight = false }) {
  return (
    <article className={`date-card ${highlight ? 'highlight' : ''}`}>
      <span className="date">{date}</span>
      <h3>{title}</h3>
      <span className="chev">↗</span>
    </article>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        <div className="section-kicker">/ CONTACT</div>
        <a href="mailto:tekclusteraud2026@gmail.com" className="footer-email">
          <h3>TEKCLUSTERAUD2026@GMAIL.COM</h3>
        </a>
      </div>
      <div className="footer-right">
        <p>
          <a href="tel:+919597714600">Harikishore K · 9597714600</a>
        </p>
        <p>
          <a href="tel:+917395936932">Tharaneesh J · 7395936932</a>
        </p>
        <p>Kongunadu College of Engineering and Technology · Trichy, Tamil Nadu</p>
      </div>
    </footer>
  );
}

function getCountdown() {
  const distance = Math.max(0, EVENT_DATE - Date.now());
  const seconds = Math.floor(distance / 1000);

  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

createRoot(document.getElementById('root')).render(<App />);
