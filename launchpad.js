(function(){
    $("#launchpad-panel").remove();
    
    var panel = $("<div id='launchpad-panel' style='background:#f4e4bc;border:1px solid #804000;padding:10px;margin:8px 0;font-family:Verdana;'></div>");
    panel.append("<h3 style='margin:0 0 8px 0;'>Attack Launchpad</h3>");
    
    var textarea = $("<textarea style='width:100%;height:120px;font-family:monospace;font-size:11px;'></textarea>");
    var loadBtn = $("<button style='margin-top:5px;'>Load Attacks</button>");
    var tableContainer = $("<div></div>");
    
    panel.append("<div style='margin-bottom:5px;font-size:12px;'>Paste DS Workbench export (one line per attack):</div>")
         .append(textarea).append(loadBtn).append(tableContainer);
    
    var mount = $("#contentContainer").length ? $("#contentContainer") : $("body");
    mount.prepend(panel);
    
    function parseLine(line) {
        line = line.trim();
        if (!line) return null;
        var parts = line.split("&");
        if (parts.length < 8) return null;
        var troops = {};
        parts[7].split("/").forEach(function(t){
            var kv = t.split("=");
            if (kv.length === 2) {
                try { troops[kv[0]] = parseInt(atob(kv[1])); } catch(e){}
            }
        });
        return {
            originId: parts[0],
            targetId: parts[1],
            slowest: parts[2],
            arrivalMs: parseInt(parts[3]),
            troops: troops
        };
    }
    
    var serverOffset = (typeof Timing !== "undefined" && Timing.offset_server) ? Timing.offset_server : 0;
    function serverNow() { return Date.now() + serverOffset; }
    
    function buildUrl(a) {
        var p = "/game.php?village=" + a.originId + "&screen=place&target=" + a.targetId;
        for (var u in a.troops) p += "&" + u + "=" + a.troops[u];
        return p;
    }
    
    function renderPlan(plan) {
        tableContainer.empty();
        if (plan.length === 0) {
            tableContainer.append("<div style='color:red;'>No valid attacks parsed.</div>");
            return;
        }
        tableContainer.append("<div style='margin:8px 0;'>Loaded <b>" + plan.length + "</b> attacks.</div>");
        
        var table = $("<table class='vis' width='100%'><thead><tr><th>#</th><th>Origin</th><th>Target</th><th>Troops</th><th>Arrival</th><th>Countdown</th><th>Send</th></tr></thead><tbody></tbody></table>");
        var tbody = table.find("tbody");
        
        plan.forEach(function(att, i) {
            var ts = Object.keys(att.troops).map(function(u){ return att.troops[u]+" "+u; }).join(", ");
            var row = $("<tr><td>"+(i+1)+"</td><td>"+att.originId+"</td><td>"+att.targetId+"</td><td style='font-size:11px;'>"+ts+"</td><td style='font-size:11px;'>"+new Date(att.arrivalMs).toLocaleString()+"</td><td class='cd' data-target='"+att.arrivalMs+"'>--</td><td><button class='btn'>Send</button></td></tr>");
            row.find(".btn").on("click", function() {
                window.open(buildUrl(att), "_blank");
                $(this).css("background","#90ee90").text("Sent");
            });
            tbody.append(row);
        });
        
        tableContainer.append(table);
    }
    
    loadBtn.on("click", function() {
        var plan = textarea.val().split("\n").map(parseLine).filter(Boolean);
        renderPlan(plan);
        textarea.css("height","40px");
    });
    
    if (window._lpInt) clearInterval(window._lpInt);
    window._lpInt = setInterval(function() {
        var now = serverNow();
        $("#launchpad-panel .cd").each(function(){
            var t = parseInt($(this).data("target"));
            var d = t - now;
            if (d <= 0) {
                $(this).text("READY").css({color:"#080",fontWeight:"bold"});
                $(this).closest("tr").css("background","#d4ffd4");
            } else {
                var h = Math.floor(d/3600000), m = Math.floor((d%3600000)/60000), s = Math.floor((d%60000)/1000);
                $(this).text(h+"h "+m+"m "+s+"s");
            }
        });
    }, 200);
})();
