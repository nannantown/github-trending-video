import React from "react";
import { Composition } from "remotion";
import { TrendingVideo, Props } from "./compositions/TrendingVideo";
import {
  defaultProjects,
  defaultDurations,
  calculateFrameDurations,
} from "./data";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TrendingVideo"
        component={
          TrendingVideo as unknown as React.FC<Record<string, unknown>>
        }
        durationInFrames={calculateFrameDurations(defaultDurations).total}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          projects: defaultProjects,
          audioDurations: defaultDurations,
        }}
        calculateMetadata={async ({ props }) => {
          const p = props as unknown as Props;
          const d = p.audioDurations || defaultDurations;
          return { durationInFrames: calculateFrameDurations(d).total };
        }}
      />
    </>
  );
};
