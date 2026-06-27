// ASCII banner — branding flourish shown on bare invocation and --help only.
// NEVER printed by scriptable commands (run/poll/status/report); their stdout
// must stay machine-parseable (poll'''s exit-code/line contract depends on it).
// Art derived from the "bröther may i have some lööps" cross-stitch meme.
export const BANNER = String.raw`
                bröther may i                 

              +*=
              o+:==o#%%%%%*+=++#:
:             :o: +%@%%@@%o+:  *o
+:            *o===#+ +@#+:   +#*o=
=            o#**o     +==+oo++++=o#
           :%oo++*+   :##*:o**o++++%
         :++:      :   :  :++++++==%+
       =+:         o#+    :::: :=  o@%+
     =#@+         =::+=  :=:       #@@@%o
    o@%%%                         o@@%%@@%*
   :@@%%%:                       =%@%%%%%@@#o
   #oo#@%:                       o@@%%%%%@%=+*
   #   :                         =%@@%%%@@# :*
  *+    =+                        :#@@@@@@#::*
 =o   =*+                          :+#@@@@*::*
 *+   %+                             :o**= ::*
 +o  :%=                    ::       :+:   :=o
 +o   %=:::                 o+      :oo   :=+*
  o++#o=:==:               +*     :+o:   ::+#
     *o:===::              +*     #=  : :==+#
      **======= ::   ::    =#     %=:::::=:=#
       :o*============::=::=*o   *o::======+#
         o*o+==============:+*+++*=======++#=
          **#*o+==::========:====:===+o**o=
             : =ooooooooooooooooo+=*#o:
                              :**+==+*
                                :oo++#

               have some lööps                
`;
