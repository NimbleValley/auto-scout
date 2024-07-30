import ffmpeg from "fluent-ffmpeg";

function resizingffmpeg(
    video,
    width,
    height,
    tempFile,
    autoPad,
    padColor
) {
    return new Promise((res, rej) => {
        let ff = ffmpeg().input(video).size(`${width}x${height}`);
        autoPad ? (ff = ff.autoPad(autoPad, padColor)) : null;
        ff.output(tempFile)
            .on("start", function (commandLine) {
                console.log("Spawned ffmpeg with command: " + commandLine);
                console.log("Start resizingffmpeg:", video);
            })
            // .on("progress", function(progress) {
            //   console.log(progress);
            // })
            .on("error", function (err) {
                console.log("Problem performing ffmpeg function");
                rej(err);
            })
            .on("end", function () {
                console.log("End resizingffmpeg:", tempFile);
                res(tempFile);
            })
            .run();
    });
}

function videoCropCenterffmpeg(
    video,
    w,
    h,
    tempFile
) {
    return new Promise((res, rej) => {
        ffmpeg()
            .input(video)
            .videoFilters([
                {
                    filter: "crop",
                    options: {
                        w,
                        h,
                    },
                },
            ])
            .output(tempFile)
            .on("start", function (commandLine) {
                console.log("Spawned ffmpeg with command: " + commandLine);
                console.log("Start videoCropCenterffmpeg:", video);
            })
            // .on("progress", function(progress) {
            //   console.log(progress);
            // })
            .on("error", function (err) {
                console.log("Problem performing ffmpeg function");
                rej(err);
            })
            .on("end", function () {
                console.log("End videoCropCenterffmpeg:", tempFile);
                res(tempFile);
            })
            .run();
    });
}

function getDimentions(media) {
    console.log("Getting Dimentions from:", media);
    return new Promise ((res, rej) => {
        ffmpeg.ffprobe(media, async function (err, metadata) {
            if (err) {
                console.log("Error occured while getting dimensions of:", media);
                rej(err);
            }
            res({
                width: metadata.streams[0].width,
                height: metadata.streams[0].height,
            });
        });
    });
}

export async function videoScale(video, newWidth, newHeight) {
    const output = "scaledOutput.mp4";
    const { width, height } = await getDimentions(video);
    if ((width / height).toFixed(2) > (newWidth / newHeight).toFixed(2)) {
        // y=0 case
        // landscape to potrait case
        const x = width - (newWidth / newHeight) * height;
        console.log(`New Intrim Res: ${width - x}x${height}`);
        const cropping = "tempCropped-" + output;
        let cropped = await videoCropCenterffmpeg(
            video,
            width - x,
            height,
            cropping
        );
        let resized = await resizingffmpeg(cropped, newWidth, newHeight, output);
        // unlink temp cropping file
        // fs.unlink(cropping, (err) => {
        //   if (err) console.log(err);
        //   console.log(`Temp file ${cropping} deleted Successfuly...`);
        // });
        return resized;
    } else if ((width / height).toFixed(2) < (newWidth / newHeight).toFixed(2)) {
        // x=0 case
        // potrait to landscape case
        // calculate crop or resize with padding or blur sides
        // or just return with black bars on the side
        return await resizingffmpeg(video, newWidth, newHeight, output, true);
    } else {
        console.log("Same Aspect Ratio forward for resizing");
        return await resizingffmpeg(video, newWidth, newHeight, output);
    }
}