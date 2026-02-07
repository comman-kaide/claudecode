import React from 'react';
import {Sequence, useVideoConfig} from 'remotion';
import {TokushimaZoom} from './scenes/TokushimaZoom';
import {TokyoToTokushimaRoute} from './scenes/TokyoToTokushimaRoute';
import {WorldRoute} from './scenes/WorldRoute';
import {EiffelTowerScene} from './scenes/EiffelTower';

/**
 * Main composition orchestrating the full Japan → Paris trip.
 *
 * Timeline (at 30 fps):
 *   0–180  (0–6s)   Zoom out from Tokushima
 * 180–390  (6–13s)  Tokyo → Tokushima route with camera follow
 * 390–540  (13–18s) World route from Japan to Paris
 * 540–900  (18–30s) 3D Eiffel Tower reveal
 */
export const JapanTrip: React.FC = () => {
  return (
    <>
      {/* Scene 1: Zoom out of Tokushima, Japan */}
      <Sequence from={0} durationInFrames={180} name="Tokushima Zoom">
        <TokushimaZoom />
      </Sequence>

      {/* Scene 2: Animated route from Tokyo to Tokushima */}
      <Sequence
        from={180}
        durationInFrames={210}
        name="Tokyo → Tokushima Route"
      >
        <TokyoToTokushimaRoute />
      </Sequence>

      {/* Scene 3: World map route from Japan to Paris */}
      <Sequence from={390} durationInFrames={150} name="World Route to Paris">
        <WorldRoute />
      </Sequence>

      {/* Scene 4: 3D Eiffel Tower in Paris */}
      <Sequence from={540} durationInFrames={360} name="Eiffel Tower 3D">
        <EiffelTowerScene />
      </Sequence>
    </>
  );
};
