var startTime;
var endTime;

// Trim sliders
function getVals() {
    // Set video time
    document.getElementById('trimming-video').currentTime = this.value;

    // Get slider values
    var parent = this.parentNode;
    var slides = parent.getElementsByTagName("input");
    var slide1 = parseFloat(slides[0].value);
    var slide2 = parseFloat(slides[1].value);
    // Neither slider will clip the other, so make sure we determine which is larger
    if (slide1 > slide2) { var tmp = slide2; slide2 = slide1; slide1 = tmp; }

    var displayElement = parent.getElementsByClassName("rangeValues")[0];
    displayElement.innerHTML = slide1 + " - " + slide2;
    startTime = slide1;
    endTime = slide2;
}

export function getTimes() {
    return {
        "startTime": startTime, 
        "endTime": endTime
    }
}

/*
window.onload = function () {
    // Initialize Sliders
    /*let sliderSections = document.getElementsByClassName("range-slider");
    for (var x = 0; x < sliderSections.length; x++) {
        var sliders = sliderSections[x].getElementsByTagName("input");
        for (var y = 0; y < sliders.length; y++) {
            if (sliders[y].type === "range") {
                sliders[y].oninput = getVals;
                // Manually trigger event first time to display values
                sliders[y].oninput();
            }
        }
    }
}
*/

let startSlider = document.getElementById('auto-start-slider');
startSlider.addEventListener('input', function() {
    // Set video time
    document.getElementById('trimming-video').currentTime = this.value;

    startTime = parseInt(this.value);
    endTime = parseInt(this.value) + 15.5;
});

export function updateSliderMax() {
    let value = Math.round(document.getElementById('trimming-video').duration);

    /*let sliderSections = document.getElementsByClassName("range-slider");
    for (var x = 0; x < sliderSections.length; x++) {
        let sliders = sliderSections[x].getElementsByTagName("input");
        for (var y = 0; y < sliders.length; y++) {
            if (sliders[y].type === "range") {
                sliders[y].max = value;
            }
        }
    }*/
    document.getElementById('auto-start-slider').max = value;
}