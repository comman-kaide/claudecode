import React from 'react';
import {Composition} from 'remotion';
import {JapanTrip} from './JapanTrip';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="JapanTrip"
        component={JapanTrip}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
