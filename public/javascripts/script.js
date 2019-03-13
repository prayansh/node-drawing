$(function () {
    // This demo depends on the canvas element
    if (!('getContext' in document.createElement('canvas'))) {
        alert('Sorry, it looks like your browser does not support canvas!');
        return false;
    }

    var doc = $(document),
        win = $(window),
        canvas = $('#paper'),
        collab = $('#collab'),
        ctx = canvas[0].getContext('2d'),
        ctxOther = collab[0].getContext('2d')
    ;

    // Generate an unique ID
    var id = Math.round($.now() * Math.random());

    // A flag for mouseDown activity
    var mouseDown = false;

    var clients = {};
    var cursors = {};

    var socket = io();
    var userColor = '#fff';
    var ModeEnums = {PEN: 1, TEXT: 2, SELECT: 3, SHAPE: 4};
    var mode = ModeEnums.SELECT;
    var canvasState = new CanvasState(canvas[0]);

    $('#pen').click(function (_) {
        mode = ModeEnums.PEN;
    });
    $('#move').click(function (_) {
        mode = ModeEnums.SELECT;
    });
    $('#text').click(function (_) {
        mode = ModeEnums.TEXT;
    });
    $('#shape').click(function (_) {
        mode = ModeEnums.SHAPE;
    });
    $('#erase').click(function (_) {
        // delete selected object from canvas
        if (canvasState.selection) {
            canvasState.remove(canvasState.selection);
            canvasState.invalidate();
            canvasState.deselect();
        }
    });

    socket.on('init', function (initData) {
        // id = initData.id;
        userColor = initData.color;
    });

    function redrawPeerCanvas() {
        ctxOther.clearRect(0, 0, collab[0].width, collab[0].height);
        Object.keys(clients).forEach(function (id) {
            var data = clients[id].canvasState;
            var clientColor = clients[id].color;
            data.pathList.forEach(function (path) {
                var p = new PathRender(0, 0, clientColor);
                p.pointsNotDrawn = path.points;
                p.draw(ctxOther);
            });
            data.textList.forEach(function (text) {
                var t = new TextRender(text.fontSize, text.x, text.y, 0, text.text, clientColor);
                t.draw(ctxOther);
            });
        });
    }

    // Receive data from other clients
    socket.on('moving', function (data) {

        if (!(data.id in clients)) {
            // a new user has come online. create a cursor for them
            cursors[data.id] = $('<div class="cursor">').appendTo('#cursors');
        }

        // Move the mouse pointer
        cursors[data.id].css({
            'left': data.x,
            'top': data.y
        });

        // Saving the current client state
        clients[data.id] = data;
        console.log("Received: " + JSON.stringify(data));
        clients[data.id].updated = $.now();
        redrawPeerCanvas();
    });

    var prev = {
        x: 100,
        y: 100
    };

    canvas.on('mousedown', function (e) {
        e.preventDefault();
        var mX = e.pageX;
        var mY = e.pageY;
        mouseDown = true;
        switch (mode) {
            case ModeEnums.PEN: {
                var p = new PathRender(mX, mY, userColor);
                canvasState.addPath(p);
            }
                break;
            case ModeEnums.SHAPE: {

            }
                break;
            case ModeEnums.TEXT: {
                var t = new TextRender(96, mX, mY, 0, "Hello", userColor);
                canvasState.addText(t);
                t.draw(ctx);
            }
                break;
            case ModeEnums.SELECT: {
                console.log("(" + mX + ", " + mY + ")");
                var newSelected = false;
                // Check for path selection
                canvasState.pathList.forEach(function (p) {
                    if (p.contains(mX, mY)) {
                        var mySel = p;
                        // Keep track of where in the object we clicked
                        // so we can move it smoothly (see mousemove)
                        canvasState.dragStartX = mX;
                        canvasState.dragStartY = mY;
                        canvasState.dragging = true;
                        canvasState.selection = mySel;
                        canvasState.valid = false;
                        newSelected = true;
                    }
                });
                if (!newSelected) { // Check for text selection
                    canvasState.textList.forEach(function (t) {
                        if (t.contains(mX, mY)) {
                            var mySel = t;
                            // Keep track of where in the object we clicked
                            // so we can move it smoothly (see mousemove)
                            canvasState.dragStartX = mX;
                            canvasState.dragStartY = mY;
                            canvasState.dragging = true;
                            canvasState.selection = mySel;
                            canvasState.valid = false;
                            newSelected = true;
                        }
                    });
                }
                if (!newSelected && canvasState.selection) {
                    canvasState.deselect()
                }
            }
                break;
        }
    });


    doc.bind('mouseup mouseleave', function () {
        mouseDown = false;
        canvasState.dragging = false;
    });

    var lastEmit = $.now();

    function toDataObject(canvasState) {
        var data = {};
        data.pathList = [];
        canvasState.pathList.forEach(function (path) {
            var p = {};
            p.points = path.points;
            data.pathList.push(p);
        });
        data.textList = [];
        canvasState.textList.forEach(function (text) {
            var t = {};
            t.x = text.x;
            t.y = text.y;
            t.fontSize = text.fontSize;
            t.text = text.text;
            data.textList.push(t);
        });
        console.log("Sending: " + JSON.stringify(data));
        return data;
    }

    doc.on('mousemove', function (e) {
        // e.preventDefault();
        var mX = e.pageX;
        var mY = e.pageY;
        if ($.now() - lastEmit > 60) {
            socket.emit('mousemove', {
                'x': e.pageX,
                'y': e.pageY,
                'id': id,
                'color': userColor,
                'canvasState': toDataObject(canvasState),
                // 'mouseDown': mouseDown,
            });
            lastEmit = $.now();
        }

        // Draw a line for the current user's movement, as it is
        // not received in the socket.on('moving') event above

        if (mouseDown) {
            switch (mode) {
                case ModeEnums.PEN:
                    var p = canvasState.pathList[canvasState.pathList.length - 1];
                    p.addPoint(e.pageX, e.pageY);
                    p.draw(ctx);
                    break;
                case ModeEnums.SHAPE:
                    break;
                case ModeEnums.TEXT:
                    break;
                case ModeEnums.SELECT:
                    if (canvasState.dragging) {
                        // We don't want to drag the object by its top-left corner,
                        // we want to drag from where we clicked.
                        // Thats why we saved the offset and use it here
                        var dx = mX - canvasState.dragStartX;
                        var dy = mY - canvasState.dragStartY;
                        canvasState.dragStartX = mX;
                        canvasState.dragStartY = mY;
                        canvasState.selection.displace(dx, dy);
                        canvasState.invalidate(); // Something's dragging so we must redraw
                    }
                    break;
            }
            prev.x = e.pageX;
            prev.y = e.pageY;
        }
    });

    // Remove inactive clients after 10 seconds of inactivity
    setInterval(function () {
        for (ident in clients) {
            if ($.now() - clients[ident].updated > 10000) {

                // Last update was more than 10 seconds ago.
                // This user has probably closed the page

                cursors[ident].remove();
                delete clients[ident];
                delete cursors[ident];
            }
        }
    }, 10000);

    // Redraw check
    setInterval(function () {
        canvasState.draw(ctx); // check for invalidation here
    }, 30);  //maybe longer interval???
});