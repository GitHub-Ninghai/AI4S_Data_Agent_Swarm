import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Agent node data for background animation
// ---------------------------------------------------------------------------

interface AgentNode {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  label: string;
  status: "working" | "idle" | "thinking";
  statusTimer: number;
  pulsePhase: number;
}

const AGENT_LABELS = [
  "PDF Parser",
  "Data Synth",
  "QA Engine",
  "Quality Check",
  "Crawler",
  "Pipeline",
  "Sci-Evo",
  "Analyzer",
  "MinerU",
  "Formatter",
  "Validator",
  "Extractor",
];

const CODE_SNIPPETS = [
  "query(sdk).pipe(agents)",
  "await sdk.parse(pdf)",
  "agents.map(extract)",
  "pipeline.run(tasks)",
  "fetch('arxiv.org/search')",
  "mineru.analyze(doc)",
  "qa.generate(pairs)",
  "quality.check(output)",
  "sciEvo.synthesize(papers)",
  "result.validate(schema)",
  "data.transform(raw)",
  "crawl('semantic-scholar')",
  "batch.process(files)",
  "stream.pipe(filter)",
  "task.execute(agent)",
];

// ---------------------------------------------------------------------------
// WelcomeScreen component
// ---------------------------------------------------------------------------

interface Props {
  onEnter: () => void;
}

export function WelcomeScreen({ onEnter }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<AgentNode[]>([]);
  const animRef = useRef(0);
  const [titleVisible, setTitleVisible] = useState(false);
  const [subtitleVisible, setSubtitleVisible] = useState(false);
  const [btnVisible, setBtnVisible] = useState(false);
  const [typedTitle, setTypedTitle] = useState("");
  const fullTitle = "AI4S_Data_Agent_Swarm";
  const typingRef = useRef(0);

  // Initialize agent nodes
  const initNodes = useCallback((width: number, height: number) => {
    const count = 18;
    const nodes: AgentNode[] = [];
    for (let i = 0; i < count; i++) {
      nodes.push({
        id: i,
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        label: AGENT_LABELS[i % AGENT_LABELS.length],
        status: ["working", "idle", "thinking"][Math.floor(Math.random() * 3)] as AgentNode["status"],
        statusTimer: Math.random() * 200,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }
    nodesRef.current = nodes;
  }, []);

  // Canvas animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (nodesRef.current.length === 0) {
        initNodes(canvas.width, canvas.height);
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const codeColumns: { x: number; y: number; speed: number; chars: string[] }[] = [];
    const charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*(){}[]|;:<>?/";
    const colWidth = 20;
    const numCols = Math.ceil(canvas.width / colWidth);
    for (let i = 0; i < numCols; i++) {
      const len = 10 + Math.floor(Math.random() * 20);
      const chars: string[] = [];
      for (let j = 0; j < len; j++) {
        chars.push(charSet[Math.floor(Math.random() * charSet.length)]);
      }
      codeColumns.push({
        x: i * colWidth,
        y: Math.random() * canvas.height * 2 - canvas.height,
        speed: 0.5 + Math.random() * 1.5,
        chars,
      });
    }

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Semi-transparent clear for trail effect
      ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
      ctx.fillRect(0, 0, w, h);

      // Draw code rain
      ctx.font = "13px 'Courier New', monospace";
      for (const col of codeColumns) {
        for (let i = 0; i < col.chars.length; i++) {
          const charY = col.y + i * 16;
          if (charY < -16 || charY > h + 16) continue;
          const alpha = i === col.chars.length - 1 ? 1 : Math.max(0, 0.5 - i * 0.03);
          ctx.fillStyle = i === col.chars.length - 1
            ? `rgba(120, 255, 180, ${alpha})`
            : `rgba(0, 200, 100, ${alpha})`;
          ctx.fillText(col.chars[i], col.x, charY);
        }
        col.y += col.speed;
        if (col.y > h + col.chars.length * 16) {
          col.y = -col.chars.length * 16;
          // Randomize chars
          for (let j = 0; j < col.chars.length; j++) {
            if (Math.random() < 0.3) {
              col.chars[j] = charSet[Math.floor(Math.random() * charSet.length)];
            }
          }
        }
      }

      // Update and draw agent nodes
      const nodes = nodesRef.current;
      const connectionDist = 180;

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        node.pulsePhase += 0.03;
        node.statusTimer -= 1;
        if (node.statusTimer <= 0) {
          node.status = ["working", "idle", "thinking"][Math.floor(Math.random() * 3)] as AgentNode["status"];
          node.statusTimer = 100 + Math.random() * 200;
        }

        // Bounce off edges
        if (node.x < 0 || node.x > w) node.vx *= -1;
        if (node.y < 0 || node.y > h) node.vy *= -1;
        node.x = Math.max(0, Math.min(w, node.x));
        node.y = Math.max(0, Math.min(h, node.y));
      }

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < connectionDist) {
            const alpha = (1 - dist / connectionDist) * 0.25;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 180, 255, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const pulse = Math.sin(node.pulsePhase) * 0.3 + 0.7;
        const baseRadius = 3;

        // Glow
        const grad = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, 20 * pulse,
        );
        const color = node.status === "working"
          ? "0, 255, 136"
          : node.status === "thinking"
            ? "100, 180, 255"
            : "80, 80, 120";
        grad.addColorStop(0, `rgba(${color}, 0.4)`);
        grad.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 20 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.fillStyle = `rgba(${color}, ${pulse})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, baseRadius * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.font = "9px 'Courier New', monospace";
        ctx.fillStyle = `rgba(${color}, ${0.4 * pulse})`;
        ctx.fillText(node.label, node.x + 8, node.y + 3);
      }

      // Draw floating code snippets
      const time = Date.now() * 0.001;
      ctx.font = "11px 'Courier New', monospace";
      for (let i = 0; i < CODE_SNIPPETS.length; i++) {
        const snippet = CODE_SNIPPETS[i];
        const sx = (Math.sin(time * 0.2 + i * 1.7) * 0.4 + 0.5) * w;
        const sy = (Math.cos(time * 0.15 + i * 2.3) * 0.4 + 0.5) * h;
        const alpha = 0.06 + Math.sin(time + i) * 0.03;
        ctx.fillStyle = `rgba(0, 200, 255, ${alpha})`;
        ctx.fillText(snippet, sx, sy);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [initNodes]);

  // Typing effect for title
  useEffect(() => {
    if (!titleVisible) return;
    const interval = setInterval(() => {
      typingRef.current += 1;
      setTypedTitle(fullTitle.slice(0, typingRef.current));
      if (typingRef.current >= fullTitle.length) {
        clearInterval(interval);
        setTimeout(() => setSubtitleVisible(true), 300);
        setTimeout(() => setBtnVisible(true), 700);
      }
    }, 60);
    return () => clearInterval(interval);
  }, [titleVisible]);

  // Trigger title appearance
  useEffect(() => {
    const t = setTimeout(() => setTitleVisible(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="welcome-screen">
      <canvas ref={canvasRef} className="welcome-canvas" />

      {/* Vignette overlay */}
      <div className="welcome-vignette" />

      {/* Central content */}
      <div className="welcome-content">
        {/* Decorative top line */}
        <div className={`welcome-line ${titleVisible ? "welcome-line-visible" : ""}`} />

        {/* Title */}
        <h1 className={`welcome-title ${titleVisible ? "welcome-title-visible" : ""}`}>
          {typedTitle}
          <span className="welcome-cursor">|</span>
        </h1>

        {/* Subtitle */}
        <p className={`welcome-subtitle ${subtitleVisible ? "welcome-subtitle-visible" : ""}`}>
          AI for Science 数据合成 &middot; 多 Agent 协同编排平台
        </p>

        {/* Tech badges */}
        <div className={`welcome-badges ${subtitleVisible ? "welcome-badges-visible" : ""}`}>
          <span className="welcome-badge">Claude Agent SDK</span>
          <span className="welcome-badge">MinerU</span>
          <span className="welcome-badge">React</span>
          <span className="welcome-badge">Node.js</span>
        </div>

        {/* Enter button */}
        <button
          className={`welcome-btn ${btnVisible ? "welcome-btn-visible" : ""}`}
          onClick={onEnter}
        >
          <span className="welcome-btn-text">开始使用</span>
          <span className="welcome-btn-arrow">&#x2192;</span>
        </button>

        {/* Bottom decorative line */}
        <div className={`welcome-line-bottom ${btnVisible ? "welcome-line-visible" : ""}`} />

        {/* Version */}
        <p className={`welcome-version ${btnVisible ? "welcome-subtitle-visible" : ""}`}>
          v0.1.0 &middot; Powered by Claude Code
        </p>
      </div>
    </div>
  );
}
