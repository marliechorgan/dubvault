const fs = require('fs').promises;
const path = require('path');

const dataFiles = {
  users: path.join(__dirname, '..', 'users.json'),
  tracks: path.join(__dirname, '..', 'tracks.json'),
  ratings: path.join(__dirname, '..', 'ratings.json')
};

async function readData(filePath, defaultData = []) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  const data = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(data);
  } catch {
    return defaultData;
  }
}

async function writeData(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function getUsers() {
  return readData(dataFiles.users);
}

async function saveUsers(users) {
  return writeData(dataFiles.users, users);
}

async function getTracks() {
  const tracks = await readData(dataFiles.tracks);
  if (!tracks || tracks.length === 0) {
    const sampleTracks = [
      {
        id: Date.now(),
        title: "Sample Dub 1",
        artist: "Underground Artist",
        filePath: "sample1.mp3",
        artworkPath: "sample_artwork1.jpg",
        expiresOn: new Date(
          Date.now() + 60 * 24 * 60 * 60 * 1000
        ).toISOString()
      },
      {
        id: Date.now() + 1,
        title: "Sample Dub 2",
        artist: "Local Producer",
        filePath: "sample2.mp3",
        artworkPath: "sample_artwork2.jpg",
        expiresOn: new Date(
          Date.now() + 60 * 24 * 60 * 60 * 1000
        ).toISOString()
      }
    ];
    await saveTracks(sampleTracks);
    return sampleTracks;
  }
  return tracks;
}

async function saveTracks(tracks) {
  return writeData(dataFiles.tracks, tracks);
}

async function getRatings() {
  return readData(dataFiles.ratings);
}

async function saveRatings(ratings) {
  return writeData(dataFiles.ratings, ratings);
}

module.exports = {
  getUsers,
  saveUsers,
  getTracks,
  saveTracks,
  getRatings,
  saveRatings
};
