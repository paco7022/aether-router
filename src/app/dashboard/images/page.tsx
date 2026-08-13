import ImagesStudio from "./images-studio";

export const dynamic = "force-dynamic";

export default function ImagesPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Image Studio</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Generación de imágenes y video sobre nuestra propia GPU. Se cobra por generación
          (no por tokens) y el precio escala con resolución, steps y frames. Lo mismo está
          disponible por API en{" "}
          <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">
            POST /v1/images/generations
          </code>{" "}
          y{" "}
          <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">
            POST /v1/media/jobs
          </code>
          .
        </p>
      </div>

      <ImagesStudio />
    </div>
  );
}
