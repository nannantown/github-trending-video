import React from "react";
import {
  AbsoluteFill,
  Audio,
  Series,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Opening } from "../components/Opening";
import { OpeningTop1 } from "../components/OpeningTop1";
import { ProjectCard } from "../components/ProjectCard";
import { Ending } from "../components/Ending";
import { Subtitle, SubtitleData } from "../components/Subtitle";
import {
  Project,
  AudioDurations,
  SubtitleMap,
  defaultDurations,
  calculateFrameDurations,
} from "../data";

/**
 * "brand" = the shared opening (Instagram, and the default for every render).
 * "top1"  = YouTube-only opening with the day's TOP1 repo from frame 0
 *           (2026-09-14 distribution experiment B).
 */
export type OpeningVariant = "brand" | "top1";

export interface Props {
  projects: Project[];
  audioDurations?: AudioDurations;
  subtitles?: SubtitleMap;
  openingVariant?: OpeningVariant;
}

export const TrendingVideo: React.FC<Props> = ({
  projects,
  audioDurations,
  subtitles,
  openingVariant = "brand",
}) => {
  const frames = calculateFrameDurations(audioDurations || defaultDurations);

  const sub = (key: string): SubtitleData | undefined =>
    subtitles?.[key] as SubtitleData | undefined;

  return (
    <AbsoluteFill>
      {/* BGM - low volume ambient pad under narration */}
      <Audio src={staticFile("audio/bgm.wav")} volume={0.12} />

      <Series>
        <Series.Sequence durationInFrames={frames.opening}>
          {openingVariant === "top1" && projects[0] ? (
            <OpeningTop1 topProject={projects[0]} />
          ) : (
            <Opening />
          )}
          <SubtitleWrapper data={sub("opening")} />
          <Audio src={staticFile("audio/opening.mp3")} volume={1} />
        </Series.Sequence>

        {projects.slice(0, 5).map((project, i) => (
          <Series.Sequence
            key={project.rank}
            durationInFrames={frames.projects[i] || frames.projects[0]}
          >
            <ProjectCardWrapper project={project} />
            <SubtitleWrapper data={sub(`project-${i + 1}`)} />
            <Audio
              src={staticFile(`audio/project-${i + 1}.mp3`)}
              volume={1}
            />
          </Series.Sequence>
        ))}

        <Series.Sequence durationInFrames={frames.ending}>
          <Ending />
          <SubtitleWrapper data={sub("ending")} />
          <Audio src={staticFile("audio/ending.mp3")} volume={1} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

const ProjectCardWrapper: React.FC<{ project: Project }> = ({ project }) => {
  const localFrame = useCurrentFrame();
  return <ProjectCard project={project} localFrame={localFrame} />;
};

const SubtitleWrapper: React.FC<{ data?: SubtitleData }> = ({ data }) => {
  return <Subtitle data={data} />;
};
