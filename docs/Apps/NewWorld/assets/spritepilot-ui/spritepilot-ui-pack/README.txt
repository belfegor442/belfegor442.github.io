SpritePilot UI & Feedback Pack — 9 animated pixel-art assets
https://spritepilot.com/free-game-assets

Pop-in alerts, a check and a cross, a level-up burst, a heartbeat, a bouncing arrow, a lock-on reticle and a spinner: icons that say something happened.

LICENSE
CC0 1.0 (public domain): use these in any project, commercial or not,
change them and share them. No credit needed (a link to spritepilot.com is
always appreciated). See LICENSE.txt.

HOW THEY WERE MADE
Drawn pixel by pixel by code written for SpritePilot. Not AI-generated, and
not traced or adapted from anyone else's art.

WHAT'S INSIDE
  16px/ and 32px/    one PNG per asset: the frames side by side, left to right
  previews/          an animated GIF of each one at 4x size, plus a still PNG
  ui-pack.json       the frame size, frame count and speed of every file

  Alert bubble     9 frames  15 fps  plays once  alert-bubble-16px_strip9.png, alert-bubble-32px_strip9.png
  Question bubble  9 frames  12 fps  plays once  question-bubble-16px_strip9.png, question-bubble-32px_strip9.png
  Checkmark       10 frames  15 fps  plays once  checkmark-16px_strip10.png, checkmark-32px_strip10.png
  Cross           10 frames  15 fps  plays once  cross-16px_strip10.png, cross-32px_strip10.png
  Heartbeat        8 frames  10 fps  loops       heartbeat-16px_strip8.png, heartbeat-32px_strip8.png
  Loading spinner  8 frames  12 fps  loops       loading-spinner-16px_strip8.png, loading-spinner-32px_strip8.png
  Arrow indicator  7 frames  12 fps  loops       arrow-indicator-16px_strip7.png, arrow-indicator-32px_strip7.png
  Level up        12 frames  15 fps  plays once  level-up-16px_strip12.png, level-up-32px_strip12.png
  Target marker    8 frames  10 fps  loops       target-marker-16px_strip8.png, target-marker-32px_strip8.png

The speeds are what each one was timed for; change them to taste.
Pixels are either fully opaque or fully transparent, so the art stays crisp
and never picks up dark fringes from blending.

USING A STRIP
The file name says how to slice it: alert-bubble-32px_strip9.png is 9 frames
of 32 x 32 pixels in one row. GameMaker reads the "_strip9" by itself.
  Godot 4   AnimatedSprite2D > SpriteFrames > Add Frames from Sprite Sheet,
            Horizontal = the frame count, Vertical = 1.
  Unity     Sprite Mode Multiple, Filter Mode Point (no filter), Compression
            None; Sprite Editor > Slice > Grid By Cell Size, 32 x 32.
  Phaser    this.load.spritesheet('alert-bubble', 'alert-bubble-32px_strip9.png',
              { frameWidth: 32, frameHeight: 32 })
  Anywhere  use nearest-neighbor ("point") filtering and scale by whole
            numbers (2x, 3x, 4x) so the pixels stay sharp.

Step-by-step guides:
  https://spritepilot.com/blog/godot-4-sprite-animation
  https://spritepilot.com/blog/unity-sprite-sheet-animation
  https://spritepilot.com/blog/phaser-sprite-sheets-and-atlases
Preview, re-time or convert any strip in your browser:
  https://spritepilot.com/sprite-player
