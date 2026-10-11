# Unity migration boundaries

The Unity player renders individual sprite GameObjects and terrain/fog meshes. It must never replace the battlefield with a texture containing an entire Canvas-rendered frame. Retain the deterministic Worker simulation and browser input/save contracts until a separately tested C# simulation migration is requested.

The visible WebGL canvas must never acquire a 2D context. Bake individual art textures on a separate canvas. Isometric projection and its inverse must agree between browser hit testing and Unity camera coordinates. Browser native keyboard handling must remain available to the HTML UI.

Required release evidence: a successful licensed Unity Web build, WebAssembly signature, published asset hashes, Unity frame counters advancing in the visible canvas, nonzero native actor count during a match, normal pointer selection/orders, gathering, building, tactical pause, save/reload, and no browser runtime errors.

Generated Library and authentication state are excluded from source control. Vercel serves the precompiled Web output; it does not run the Unity Editor.
