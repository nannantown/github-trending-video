import React from "react";
import {
  AbsoluteFill,
  Audio,
  Series,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Opening } from "../components/Opening";
import { ProjectCard } from "../components/ProjectCard";
import { Ending } from "../components/Ending";
import {
  Project,
  AudioDurations,
  defaultDurations,
  calculateFrameDurations,
} from "../data";

export interface Props {
  projects: Project[];
  audioDurations?: AudioDurations;
}

export const TrendingVideo: React.FC<Props> = ({
  projects,
  audioDurations,
}) => {
  const frames = calculateFrameDurations(audioDurations || defaultDurations);

  return (
    <AbsoluteFill>
      <Series>
        <Series.Sequence durationInFrames={frames.opening}>
          <Opening />
          <Audio src={staticFile("audio/opening.mp3")} volume={1} />
        </Series.Sequence>

        {projects.slice(0, 5).map((project, i) => (
          <Series.Sequence
            key={project.rank}
            durationInFrames={frames.projects[i] || frames.projects[0]}
          >
            <ProjectCardWrapper project={project} />
            <Audio
              src={staticFile(`audio/project-${i + 1}.mp3`)}
              volume={1}
            />
          </Series.Sequence>
        ))}

        <Series.Sequence durationInFrames={frames.ending}>
          <Ending />
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
