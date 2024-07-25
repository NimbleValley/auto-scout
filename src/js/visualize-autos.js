const visualizeCanvas = document.getElementById('visualize-canvas');
const ctx = visualizeCanvas.getContext('2d');

var fieldImage;
var timings = {
    'time': 0,
    'min-time': 0,
    'max-time': 233
}

var robotPredictions = [];
const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', function (e) {
    let reader = new FileReader();
    reader.onload = function(e) {
        let json = JSON.parse(e.target.result);
        console.log(json.start);

        if(parseInt(json.start) > parseInt(timings['min-time'])) {
            //timings['min-time'] = parseInt(json.start);
        }
        
        if(json.predictions.length < parseInt(timings['max-time'])) {
            timings['max-time'] =json.predictions.length;
        }

        timings.time = timings['min-time'];

        console.log(timings);
        robotPredictions.push(json);
    };
    reader.readAsText(e.target.files[0]);
});

function animate() {
    timings.time = timings.time + 1;
    //console.log(timings.time);

    if(timings.time >= timings['max-time']/1) {
        timings.time = timings['min-time'];
    }

    //console.log(timings);

    ctx.clearRect(0, 0, visualizeCanvas.width, visualizeCanvas.height);
    ctx.drawImage(fieldImage, 0, 0, visualizeCanvas.width, visualizeCanvas.height);

    for(let i = 0; i < robotPredictions.length; i ++) {
        let index = (timings.time - timings['min-time'])/1;

        //console.log(robotPredictions[i].predictions.length);

        ctx.fillStyle = robotPredictions[i].predictions[index].class;
        ctx.fillRect(robotPredictions[i].predictions[index].x, robotPredictions[i].predictions[index].y, 80, 80);
    }
}

const loadImage = src =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });

async function setup() {
    await loadImage('./client-img/field24.png').then(image =>
        fieldImage = image
    );

    visualizeCanvas.width = 54 * 40;
    visualizeCanvas.height = 26 * 40;

    setInterval(animate, 66.6);
}

setup();