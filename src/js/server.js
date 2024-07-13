import { Server } from 'socket.io';
import { createServer } from 'http';
import express from 'express';
import spawn from 'child_process';

import fs from 'fs';
import path from 'path';
const __dirname = path.resolve();

import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import ffmpeg from 'fluent-ffmpeg';

var videoTimings = {
    start: 0,
    end: 0
}

const PORT = 8080;
const app = express();
app.use(fileUpload());
app.use(bodyParser.json({
    limit: '500mb'
}));
app.use(bodyParser.urlencoded({
    limit: '500mb',
    parameterLimit: 100000,
    extended: true
}));
app.use(express.static('./src'));

const server = createServer(app);
server.listen(PORT, function () {
    console.log(`Server running on port ${PORT}`);
});
const socketio = new Server(server);
// None for now
socketio.on('connection', (socket) => {
});

// Start and end times for trim
app.post('/trim', function (req, res) {
    videoTimings = {
        start: req.body.start,
        end: req.body.end
    }

    console.log(videoTimings);

    res.end();
});

// Upload the untrimmed video
app.post('/upload', function (req, res) {
    let sampleFile;
    let uploadPath;
    console.log("Uploaded");

    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).send('No files were uploaded.');
    }

    // The name of the input field (i.e. "sampleFile") is used to retrieve the uploaded file
    sampleFile = req.files.videoFile;
    uploadPath = __dirname + '/src/temp/untrimmed.mp4';

    // Use the mv() method to place the file somewhere on your server
    sampleFile.mv(uploadPath, async function (err) {
        if (err)
            return res.status(500).send(err);

        socketio.emit('status-update', 'Video recieved');

        console.log("Uploaded");

        trimVideo();
        res.status(204).send();
    });

});

async function trimVideo() {
    return new Promise((resolve, reject) => {
        ffmpeg({ source: __dirname + '/src/temp/untrimmed.mp4' })
            .setStartTime(videoTimings.start)
            .duration(videoTimings.end - videoTimings.start)
            .on('start', function (e) {
                socketio.emit('status-update', 'Video trimming starting');
                console.log("Processing started")
            })
            .on('error', function (e) {
                console.log("Processing error: " + e);
                socketio.emit('status-update', e);
                reject();
            })
            .on('end', function (e) {
                console.log("Processing complete");
                socketio.emit('status-update', 'Video sucessfully trimmed');
                detectRobots();
                resolve();
            })
            .saveToFile(__dirname + '/src/temp/trimmed.mp4');
    });
}

function detectRobots() {
    const pythonProcess = spawn.spawn('python', [__dirname + "/src/python/detect-video.py"]);

    pythonProcess.stdout.on('data', (data) => {
        console.log(data);
    });
}