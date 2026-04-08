# darts-game

 ai-engine.js          # AI dart physics (10 levels)                                                                                                                                                                                                                                                              
      checkout-table.js     # Optimal finishes 2-170                                                                                                                                                                                                                                                                   
      routes/                                                                                                                                                                                                                                                                                                          
        players.js          # Player CRUD                                                                                                                                                                                                                                                                              
        games.js            # Game lifecycle                                                                                                                                                                                                                                                                           
        stats.js            # Player statistics                                                                                                                                                                                                                                                                        
    public/
      index.html            # Lobby page
      game.html             # Game page
      stats.html            # Statistics page
      css/app.css           # All styles
      js/
        app.js              # API client + utilities
        lobby.js            # Player/game management
        scoreboard.js       # Score display
        input-pad.js        # Dart-by-dart input
        x01-view.js         # 501/301 game view
        cricket-view.js     # Cricket game view
        throw-suggestions.js # Checkout hints + suggestions
        animation-system.js # Animations + sound + voice
        stats-view.js       # Stats rendering

    Network Access (WSL2)

    If running in WSL2 and accessing from mobile on the same network:

    # Run in PowerShell as Admin
    netsh interface portproxy add v4tov4 listenport=8080 listenaddress=0.0.0.0 connectport=8080 connectaddress=<WSL_IP>
    netsh advfirewall firewall add rule name="Darts 8080" dir=in action=allow protocol=TCP localport=8080

    Then access via your Windows LAN IP from your phone.

    License

    Private project.