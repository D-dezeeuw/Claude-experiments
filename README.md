# 3D Interactive Map of Gran Canaria

An interactive 3D terrain visualization of the island of Gran Canaria using WebGL and Three.js.

## Features

- **3D Terrain Rendering**: Realistic height map representation of Gran Canaria's volcanic terrain
- **Interactive Camera Controls**:
  - **Rotate**: Left mouse button drag
  - **Pan**: Right mouse button drag
  - **Zoom**: Mouse scroll wheel
- **Realistic Topography**: Features the island's major peaks including Pico de las Nieves (1,949m)
- **Elevation-based Coloring**: Different colors for beaches, vegetation zones, and rocky peaks
- **Ocean Rendering**: Transparent water surrounding the island

## Technology Stack

- **Three.js**: WebGL-based 3D graphics library
- **OrbitControls**: Camera control system for intuitive navigation
- **Procedural Height Map**: Algorithm-generated terrain based on Gran Canaria's actual geography

## Project Structure

```
.
├── index.html          # Main HTML file
├── js/
│   └── main.js        # 3D map implementation
└── README.md          # This file
```

## How to Run

1. Open `index.html` in a modern web browser
2. Or serve with a local web server:
   ```bash
   # Using Python 3
   python3 -m http.server 8000

   # Using Node.js
   npx http-server
   ```
3. Navigate to `http://localhost:8000` in your browser

## Geographic Features

The map models Gran Canaria's key geographic features:

- **Pico de las Nieves**: The highest peak at 1,949 meters
- **Central Mountain Range**: Volcanic peaks concentrated in the island's center
- **Coastal Lowlands**: Lower elevation areas near the coastline
- **Circular Island Shape**: The characteristic round shape of this volcanic island

## Browser Compatibility

Requires a modern browser with WebGL support:
- Chrome 9+
- Firefox 4+
- Safari 5.1+
- Edge (all versions)

## Controls Summary

| Action | Control |
|--------|---------|
| Rotate camera | Left mouse drag |
| Pan view | Right mouse drag |
| Zoom in/out | Mouse scroll |

## Implementation Details

- **Terrain Resolution**: 256x256 vertices for smooth terrain
- **Height Map Generation**: Procedural algorithm using distance fields and exponential functions
- **Lighting**: Multiple light sources (ambient, directional, hemisphere) for realistic appearance
- **Materials**: PBR (Physically Based Rendering) materials with vertex colors
- **Performance**: Hardware-accelerated WebGL rendering

## Future Enhancements

Potential improvements:
- Real elevation data from SRTM or similar sources
- Texture mapping with satellite imagery
- Points of interest markers
- Weather visualization
- Time-of-day lighting changes
- Mobile touch controls

## License

This project is open source and available for educational and demonstration purposes.
