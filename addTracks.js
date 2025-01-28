const fs = require('fs');
const path = require('path');

const tracksFile = path.join(__dirname, 'tracks.json');

// Function to add a track
function addTrack(title, artist, filePath, artworkPath) {
  const twoMonthsFromNow = new Date();
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);

  // Load existing tracks
  let tracks = [];
  if (fs.existsSync(tracksFile)) {
    tracks = JSON.parse(fs.readFileSync(tracksFile, 'utf8'));
  }

  // Create new track object
  const newTrack = {
    id: Date.now(),
    title,
    artist,
    filePath,
    artworkPath,
    expiresOn: twoMonthsFromNow.toISOString(),
  };

  // Add new track to the list
  tracks.push(newTrack);

  // Save back to file
  fs.writeFileSync(tracksFile, JSON.stringify(tracks, null, 2));
  console.log(`Track "${title}" by "${artist}" added successfully.`);
}

// Input new track details here
const title = "Example Track"; // Change this
const artist = "Example Artist"; // Change this
const filePath = "uploads/example.mp3"; // Adjust as needed
const artworkPath = "artworks/example.jpg"; // Adjust as needed

addTrack(title, artist, filePath, artworkPath);