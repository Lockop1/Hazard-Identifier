"""
For Data collection we need



incidentType()
{
# This recieves the string of what the user says and returns the type of incident the user intended to report
# This holds the different kind of incidents we will support that will be used for 
# adding to the database and for displaying the incident on the maps
# This will take the string and use a __________ to turn the user's statement/s into an incident category.



}

newReport()
{
# This takes the user's data and returns itself
# This is what the user generates
# Holds TimeStamp,UserID,Location,googlePlaceID,incidentID,incidentType("Report Dialouge"),eventID(*Remains empty on creation*);
# Stores Report into a potentialIncident database (Incidents that are not part of a live event)

}

reportCheck()
{
#This takes the newReport and calls nothing(if it doesnt create an event) or a liveEventItializer (It creates an event) or an eventRefresh (It refreshes an event timer)
# This will check if the placeID matches with another report's placeID and then checks 
# If it does not match then it creates a new potential eventID and attaches to the report then places report in potential database
# If the matched report was in the potential database or live event database.
#   If it is in the potential database then it checks if the latest report 
#       was made was within 4 minutes, if so then add one to associated eventID counter, if not then opens an eventID at the placeID, timestamp, incident type, userIDs, and sets counter to 1
#       If counter = or exceeds 5 begin liveEvent with timestamp of currentTime and incident
#
#   If it was in the liveEventDatabase then it resets the timestamp to close the event
}


liveEventInitialize()
{
# This takes the report and converts it an event with a timestamp of latest report, incident type, placeID, and closeEventTime(timestamp + 10 minutes)
# Adds eventID + data to Live Event database
}

liveEventCloser()
{
    #If an event's closeEventTime matches or is less than the current time then it closes the event (since new reports check and refresh live events we dont need to check when the last report was since it automatically updates with each new report)
}


checkUserPointDisbursement()
{
    #If a potential event never becomes an event then no points get distributed
    #If a report leads to the creation of an event or refreshes an event close timestamp, then it awards points to the user
}


"""