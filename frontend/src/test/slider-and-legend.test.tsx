import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { RiskLegend } from "@/components/ui/RiskLegend";
import { HeatmapDock } from "@/features/heatmap/HeatmapDock";
import { heatmapBridge } from "@/features/heatmap/heatmapBridge";
import type { HeatmapResponse } from "@/lib/types";

const MOCK_HEATMAP: HeatmapResponse = {
  base_time: "2026-11-16T12:00:00Z",
  hours: 49,
  load_weight_lb: 42000,
  provider: "mock",
  warnings: [],
  points: [[41.2, -96.0, Array.from({ length: 49 }, (_, i) => i % 5)]],
};

describe("RiskLegend & RiskBadge", () => {
  it("renders all five risk levels with accessible symbols and labels", () => {
    render(<RiskLegend />);
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Severe")).toBeInTheDocument();
    expect(screen.getByText("No Travel")).toBeInTheDocument();
  });

  it("renders compact legend and RiskBadge variants including unavailable", () => {
    render(
      <div>
        <RiskLegend compact />
        <RiskBadge level={4} />
        <RiskBadge level={null} />
      </div>,
    );
    expect(screen.getByText("NO TRAVEL")).toBeInTheDocument();
    expect(screen.getByLabelText("Risk level: No Travel")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Risk level: Forecast unavailable"),
    ).toBeInTheDocument();
  });
});

describe("HeatmapDock 0–48h slider", () => {
  it("updates offset label immediately and notifies bridge via requestAnimationFrame without refetching", () => {
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    const received: number[] = [];
    const unsub = heatmapBridge.subscribe((h) => received.push(h));

    render(
      <HeatmapDock
        heatmap={MOCK_HEATMAP}
        isLoading={false}
        departureIso="2026-11-16T12:00:00Z"
      />,
    );

    const slider = screen.getByRole("slider", {
      name: /forecast hour offset from departure/i,
    }) as HTMLInputElement;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("48");

    fireEvent.change(slider, { target: { value: "18" } });
    expect(screen.getByTestId("heatmap-offset-label")).toHaveTextContent(
      "+18h from departure",
    );
    expect(received).toContain(18);

    const stepForward = screen.getByRole("button", {
      name: /step forward 1 hour/i,
    });
    fireEvent.click(stepForward);
    expect(screen.getByTestId("heatmap-offset-label")).toHaveTextContent(
      "+19h from departure",
    );
    expect(received).toContain(19);

    const stepBack = screen.getByRole("button", { name: /step back 1 hour/i });
    fireEvent.click(stepBack);
    expect(screen.getByTestId("heatmap-offset-label")).toHaveTextContent(
      "+18h from departure",
    );

    unsub();
    rafSpy.mockRestore();
  });
});
