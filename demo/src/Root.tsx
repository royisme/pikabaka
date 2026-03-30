import { Composition } from "remotion";
import { PikaDemo } from "./PikaDemo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="PikaDemo"
      component={PikaDemo}
      durationInFrames={1350}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
