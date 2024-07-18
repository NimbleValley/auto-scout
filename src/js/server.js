import { Server } from 'socket.io';
import { createServer } from 'http';
import express from 'express';
import spawn from 'child_process';
import GIFEncoder from 'gifencoder';

import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
const __dirname = path.resolve();

import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import ffmpeg from 'fluent-ffmpeg';
import extractFrames from 'ffmpeg-extract-frames';

import nodecanvas from 'canvas';
import axios from 'axios';

//import youtubedl from 'youtube-dl-exec';

var videoTimings = {
    start: 0,
    end: 0,
    trim: true,
    second: 1
}

const OUTPUT_FRAMERATE_FPS = 15;
const SMOOTHING = 1;
const API_KEY = '1234';

var robotDetectionData;
var renderCriteria = {
    'hasDistortion': false,
    'hasDetections': false
}
var originalSections;

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
    socket.on('send-distortion', function (sections) {
        originalSections = sections;
        console.log(originalSections);
        renderCriteria.hasDistortion = true;
        if (renderCriteria.hasDetections) {
            renderFrames(robotDetectionData);
        }
    });
});

// Start and end times for trim
app.post('/trim', function (req, res) {
    videoTimings = {
        start: req.body.start,
        end: req.body.end,
        trim: req.body.trim,
        second: parseInt(req.body.second) - parseInt(req.body.start)
    }

    console.log(videoTimings);

    res.end();
});

// Upload the untrimmed video
app.post('/upload', function (req, res) {
    let sampleFile;
    let uploadPath;
    console.log('Uploaded');

    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).send('No files were uploaded.');
    }

    // The name of the input field (i.e. 'sampleFile') is used to retrieve the uploaded file
    sampleFile = req.files.videoFile;
    uploadPath = __dirname + '/src/temp/untrimmed.mp4';

    // Use the mv() method to place the file somewhere on your server
    sampleFile.mv(uploadPath, async function (err) {
        if (err)
            return res.status(500).send(err);

        socketio.emit('status-update', 'Video recieved');

        console.log('Uploaded');

        if (JSON.parse(videoTimings.trim)) {
            trimVideo();
        } else {
            fs.copyFile(__dirname + '/src/temp/untrimmed.mp4', __dirname + '/src/temp/trimmed.mp4', (err) => {
                if (err) throw err;
                console.log('Copied untrimmed video sucessfully');
            });
        }

        res.status(204).send();
    });

});

// Trim the video using ffmpeg
function trimVideo() {
    return new Promise((resolve, reject) => {
        ffmpeg({ source: __dirname + '/src/temp/untrimmed.mp4' })
            .setStartTime(videoTimings.start)
            .duration(videoTimings.end - videoTimings.start)
            .on('start', function (e) {
                socketio.emit('status-update', 'Video trimming starting');
                console.log('Processing started')
            })
            .on('error', function (e) {
                console.log('Processing error: ' + e);
                socketio.emit('status-update', e);
                reject();
            })
            .on('end', function (e) {
                console.log('Processing complete');
                socketio.emit('status-update', 'Video sucessfully trimmed');
                runDetections();
                resolve();
            })
            .saveToFile(__dirname + '/src/temp/trimmed.mp4');
    });
}

// Video has been trimmed, now run all detections
function runDetections() {
    detectRobots();
    getFrame().then(() => {
        segmentField(2024);
    }).catch((e) => {
        console.error(e);
    })
}

videoTimings.second = 15;
getFrame();

// Promise that saves the specified frame to use for field segmentation
function getFrame() {
    let ms = parseInt(videoTimings.second) * 1000;

    return new Promise(async (resolve, reject) => {
        try {
            await extractFrames({
                input: __dirname + '/src/temp/trimmed.mp4',
                output: __dirname + '/src/temp/fieldframe.jpg',
                offsets: [
                    ms
                ]
            });
            resolve();
        } catch (e) {
            console.log(e);
            console.log(e.msg);
            reject();
        }
    });
}

// Now segment the field
function segmentField(year) {
    const fieldFrame = fs.readFileSync(__dirname + '/src/temp/fieldframe.jpg', {
        encoding: 'base64'
    });

    switch (year) {
        case 2024:

            axios({
                method: 'POST',
                url: 'https://detect.roboflow.com/frc-field/1',
                params: {
                    api_key: API_KEY
                },
                data: fieldFrame,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            })
                .then(function (response) {
                    console.log(response.data);
                    socketio.emit('send-field-points-2024', response.data);
                })
                .catch(function (error) {
                    console.log(error.message);
                    socketio.emit('image-error', error.message);
                });
            break;
        default:
            console.error('Invalid year');
            break;
    }
}

// Sends detection job by running python script
function detectRobots() {
    socketio.emit('status-update', 'Sending robot detection job');

    const pythonProcess = spawn.spawn('python', [__dirname + '/src/python/detect-video.py']);

    // Once python script is done it will run this
    pythonProcess.stdout.on('data', (data) => {
        socketio.emit('status-update', 'Robot detection job complete');

        // Read json file saved from python script
        let jsonOutput = JSON.parse(fs.readFileSync(__dirname + '/src/temp/robotoutput.json').toString());
        socketio.emit('status-update', 'Json parse complete');

        // Then just render frames
        renderCriteria.hasDetections = true;
        robotDetectionData = jsonOutput['bumper-detection-b8q8f'];

        if (renderCriteria.hasDistortion) {
            renderFrames(robotDetectionData);
        }
    });
}

// Renders the final gif
async function renderFrames(data) {
    var img = await nodecanvas.loadImage(__dirname + '/img/field24.png');

    console.log(img);

    // Delete old frames
    try {
        fsExtra.emptyDirSync(__dirname + '/src/temp/output');
        socketio.emit('status-update', 'Emptying folder');
    } catch (e) {
        console.error('Error emptying output folder', e);
    }

    socketio.emit('status-update', 'Starting gif');

    // Dimensions of frc field: 54' by 26'
    // For testing make it really big
    const canvas = nodecanvas.createCanvas(54 * 50, 26 * 50);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(canvas.width, canvas.height);
    encoder.createReadStream().pipe(fs.createWriteStream(__dirname + '/src/temp/output/visualization.gif'));
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(1000 / OUTPUT_FRAMERATE_FPS / SMOOTHING);
    encoder.setQuality(37);

    for (let i = 0; i < data.length; i++) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'grey';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        for (let p = 0; p < data[i].predictions.length; p++) {
            let targetPoint = new Point(data[i].predictions[p].x, data[i].predictions[p].y);
            let targetSection;

            for (let s = 0; s < originalSections.length; s++) {
                let tempScreenPoints = [originalSections[s].p1.screenPoint, originalSections[s].p2.screenPoint, originalSections[s].p4.screenPoint, originalSections[s].p3.screenPoint];

                if (pointInPolygon(targetPoint, tempScreenPoints)) {
                    targetSection = originalSections[s];
                    break;
                }
            }

            if (targetSection == null) {
                console.error('Point not on field');
                continue;
            }

            let newSquare = subdivideQuad(targetSection, targetPoint);
            for (let i = 0; i < 5; i++) {
                newSquare = subdivideQuad(newSquare, targetPoint);
            }

            ctx.fillStyle = data[i].predictions[p].class;
            ctx.fillRect(newSquare.p1.worldPoint.x * 50 - 50, (26 - newSquare.p1.worldPoint.y) * 50 - 30, 60, 60);
        }

        ctx.fillStyle = 'white';
        ctx.fillRect(0, canvas.height - 10, canvas.width * (i / data.length), 10);

        encoder.addFrame(ctx);

        if (i % 5 == 0) {
            socketio.emit('status-update', `Gif ${Math.round(i / data.length * 100)}% complete`);
            console.log(Math.round(i / data.length * 100) + '%');
        }

        /*
        // To save frames to temp/frames
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(__dirname + `/src/temp/frames/frame${i}.png`, buffer);
        */
    }
    encoder.finish();
    console.log('Gif complete');
    socketio.emit('status-update', 'Gif complete');
}

// Testing with old data
function testRender() {
    let jsonOutput = JSON.parse(fs.readFileSync(__dirname + '/src/temp/robotoutput.json').toString());
    renderFrames(jsonOutput['bumper-detection-b8q8f']);
}

// TODO still a work in progress, difficult if there are frames with uneven detections
function renderSmoothFrames(data) {

    // Delete old frames
    try {
        fsExtra.emptyDirSync(__dirname + '/src/temp/output');
        socketio.emit('status-update', 'Emptying folder');
    } catch (e) {
        console.error('Error emptying output folder', e);
    }

    socketio.emit('status-update', 'Starting gif');

    // Dimensions of frc field: 54' by 26'
    // For testing make it really big
    const canvas = nodecanvas.createCanvas(2534, 1080);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(canvas.width, canvas.height);
    encoder.createReadStream().pipe(fs.createWriteStream(__dirname + '/src/temp/output/visualization.gif'));
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(1000 / OUTPUT_FRAMERATE_FPS / SMOOTHING);
    encoder.setQuality(25);

    for (let i = 0; i < data.length - 1; i++) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'grey';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Predictions for this frame and next frame
        let currentFramePredictions = [];
        let nextFramePredictions = [];
        for (let p = 0; p < data[i].predictions.length; p++) {
            // Prediction for this frame
            currentFramePredictions.push(data[i].predictions[p]);

            // Prediction for next frame
            nextFramePredictions.push(data[i + 1].predictions[p]);
        }

        // Sort by x positions first
        currentFramePredictions.sort(({ x: a }, { x: b }) => b - a);
        nextFramePredictions.sort(({ x: a }, { x: b }) => b - a);
        let sortedCurrent = [];
        let sortedNext = [];

        // TODO The robot should really be removed from the array when a closest match is found,
        // However that would fail if there are uneven (2 vs 3) predictions, one would be let out. Fix later.
        for (let currentP = 0; currentP < currentFramePredictions.length; currentP++) {
            // If next frame has no predictions then skip, still will break algorithm
            // TODO fix later
            //if (nextFramePredictions.length == 0) {
            //break;
            //}

            // Closest robot in next frame
            let closestLength = 1000000;
            let closestIndex = 0;

            // Check if there are any closer than first
            for (let nextP = 0; nextP < nextFramePredictions.length; nextP++) {

                // If they are on different alliances then skip
                if (currentFramePredictions[currentP].class_id != nextFramePredictions[nextP].class_id) {
                    continue;
                }

                // Check if length of current next prediction is closer
                let nextLength = getDistance(currentFramePredictions[currentP], nextFramePredictions[nextP]);
                if (nextLength < closestLength) {
                    // Update closest robot
                    closestIndex = nextP;
                    closestLength = nextLength;
                }
            }
            sortedCurrent.push(currentFramePredictions[currentP]);
            sortedNext.push(nextFramePredictions[closestIndex]);
        }

        //console.log(sortedCurrent);
        //console.log('\n\n\n')
        //console.log(sortedNext);

        // Add estimates between frames to smooth out motion
        for (let e = 0; e < SMOOTHING; e++) {

            // Iterate through each prediction
            for (let k = 0; k < sortedCurrent.length; k++) {

                let smoothedX = ((sortedCurrent[k].x - sortedNext[k].x) / SMOOTHING * e) + sortedNext[k].x;
                let smoothedY = ((sortedCurrent[k].y - sortedNext[k].y) / SMOOTHING * e) + sortedNext[k].y;

                ctx.fillStyle = sortedCurrent[k].class;
                ctx.fillRect(smoothedX - 30, smoothedY - 30, 60, 60)
            }

            encoder.addFrame(ctx);
        }

        if (i % 5 == 0) {
            socketio.emit('status-update', `Gif ${Math.round(i / data.length * 100)}% complete`);
            console.log(Math.round(i / data.length * 100));
        }

        /*
        // To save frames to temp/frames
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(__dirname + `/src/temp/frames/frame${i}.png`, buffer);
        */
    }
    encoder.finish();
    console.log('Gif complete');
    socketio.emit('status-update', 'Gif complete');
}

//testField();

function testField() {
    const image = fs.readFileSync(__dirname + '/src/duluth2.png', {
        encoding: 'base64'
    });

    axios({
        method: 'POST',
        url: 'https://detect.roboflow.com/frc-field/1',
        params: {
            api_key: API_KEY
        },
        data: image,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
        .then(function (response) {
            console.log(response.data);
            socketio.emit('send-field-points-2024', response.data);
        })
        .catch(function (error) {
            console.log(error.message);
            socketio.emit('image-error', error.message);
        });
}

// Subdivisions/estimation
// Top left, top right, bottom left, bottom right
function subdivideQuad(points, targetPoint) {
    points = [points.p1, points.p2, points.p3, points.p4];

    let centerPoint = new SectionPoint(getIntersectionPoint(points[0].screenPoint, points[3].screenPoint, points[1].screenPoint, points[2].screenPoint), getMidpoint(points[0].worldPoint, points[3].worldPoint));

    let vanishingPoint = getIntersectionPoint(points[0].screenPoint, points[2].screenPoint, points[1].screenPoint, points[3].screenPoint);
    let secondVanishingPoint = getIntersectionPoint(points[0].screenPoint, points[1].screenPoint, points[2].screenPoint, points[3].screenPoint);

    let nextLeft = new SectionPoint(getIntersectionPoint(secondVanishingPoint, centerPoint.screenPoint, points[0].screenPoint, points[2].screenPoint), getMidpoint(points[0].worldPoint, points[2].worldPoint));

    let nextRight = new SectionPoint(getIntersectionPoint(secondVanishingPoint, centerPoint.screenPoint, points[1].screenPoint, points[3].screenPoint), getMidpoint(points[1].worldPoint, points[3].worldPoint));

    let nextTop = new SectionPoint(getIntersectionPoint(vanishingPoint, centerPoint.screenPoint, points[0].screenPoint, points[1].screenPoint), getMidpoint(points[0].worldPoint, points[1].worldPoint));

    let nextBottom = new SectionPoint(getIntersectionPoint(vanishingPoint, centerPoint.screenPoint, points[2].screenPoint, points[3].screenPoint), getMidpoint(points[2].worldPoint, points[3].worldPoint));

    let sections = [
        new SectionGrid(points[0], nextTop, nextLeft, centerPoint),
        new SectionGrid(nextTop, points[1], centerPoint, nextRight),
        new SectionGrid(nextLeft, centerPoint, points[2], nextBottom),
        new SectionGrid(centerPoint, nextRight, nextBottom, points[3])
    ];

    for (let i = 0; i < 4; i++) {
        if (pointInPolygon(targetPoint, [sections[i].p1.screenPoint, sections[i].p2.screenPoint, sections[i].p4.screenPoint, sections[i].p3.screenPoint])) {
            return sections[i];
        }
    }

    // Should never happen but you never know
    console.error('Point not found in any subdivisions');
    return null;
}

// Returns intersection point of line through p1 + p2 and line through p3 + p4
function getIntersectionPoint(p1, p2, p3, p4) {
    var ua, ub, denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (denom == 0) {
        return null;
    }
    ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    return new Point(p1.x + ua * (p2.x - p1.x), p1.y + ua * (p2.y - p1.y));
}

function pointInPolygon(point, polygon) {
    const num_vertices = polygon.length;
    const x = point.x;
    const y = point.y;
    let inside = false;

    let p1 = polygon[0];
    let p2;

    for (let i = 1; i <= num_vertices; i++) {
        p2 = polygon[i % num_vertices];

        if (y > Math.min(p1.y, p2.y)) {
            if (y <= Math.max(p1.y, p2.y)) {
                if (x <= Math.max(p1.x, p2.x)) {
                    const x_intersection = ((y - p1.y) * (p2.x - p1.x)) / (p2.y - p1.y) + p1.x;

                    if (p1.x === p2.x || x <= x_intersection) {
                        inside = !inside;
                    }
                }
            }
        }

        p1 = p2;
    }

    return inside;
}

function getSlope(p1, p2) {
    return (p1.y - p2.y) / (p1.x - p2.x);
}

function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2), Math.pow(p1.y - p2.y, 2));
}

function getMidpoint(p1, p2) {
    return new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
}

class Point {
    x = 0;
    y = 0;

    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}

class SectionPoint {
    screenPoint;
    worldPoint;

    constructor(screenPoint, worldPoint) {
        this.screenPoint = screenPoint;
        this.worldPoint = worldPoint;
    }
}

class SectionGrid {
    p1;
    p2;
    p3;
    p4;

    constructor(p1, p2, p3, p4) {
        this.p1 = p1;
        this.p2 = p2;
        this.p3 = p3;
        this.p4 = p4;
    }
}